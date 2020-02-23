const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs-extra')
const path = require('path')
const _ = require('lodash')

const MAP_LIMIT = 2
const city = 'wx'

class Spider {
  constructor() {

  }

  async getXiaoquListByPage(page) {
    console.log(`抓取第${page}页小区`)
  	var { data: html } = await axios.get(`https://${city}.ke.com/xiaoqu/pg${page}`)
  	var $ = cheerio.load(html)
  	var list = $('.listContent li').toArray()
  	// list = list.slice(0, 1)
    
  	list = await mapLimit(list, async item => {
		  var name = $(item).find('.title a').text()
		  var id = $(item).attr('data-id')
      var positionInfo = $(item).find('.positionInfo').text().split(/[\s|/]+/).join('')
      name = positionInfo + '-' + name
  		var zuList = await this.getZuList(id, name)
  		var buyList = await this.getBuyList(id, name)
		return { name, id, zuList, buyList }
  	}, MAP_LIMIT)
  	return list
  }

  parseHouseInfo(info) {
    info = info.trim().split(/[|/]/).map(item => item.trim())
    var mianji = /[\d\.]+[㎡|平米]/.exec(info) || []
    mianji = parseFloat(mianji[0])
    var infoShi = parseFloat(_.first(/[\d]+室/.exec(info)))
    var infoTing = parseFloat(_.first(/[\d]+厅/.exec(info)))
    var infoWei = parseFloat(_.first(/[\d]+卫/.exec(info)))
    return { mianji, infoShi, infoTing, infoWei }
  }

  async getZuList(id, name) {
  	var zuLink = `http://${city}.zu.ke.com/zufang/c${id}/`
  	var { data: html } = await axios.get(zuLink)
  	var $ = cheerio.load(html)
  	var list = $('.content__list .content__list--item').toArray()
   	list = list.map(item => {
		var title = $(item).find('.content__list--item--title a').text()
		var price = $(item).find('.content__list--item-price em').text()
		var houseInfo = $(item).find('.content__list--item--des').text()
    houseInfo = this.parseHouseInfo(houseInfo)
		var link = $(item).find('.content__list--item--title a').attr('href')
		link = `https://${city}.zu.ke.com` + link
		var key = name + ' - ' + parseInt(houseInfo.mianji / 5) * 5
		title = title.trim()
		price = parseFloat(price)
		return { title, price, key, link, houseInfo }
  	})
  	list = list.filter(item => item.title)
  	return list
  }

  async getBuyList(id, name) {
  	var buyLink = `https://${city}.ke.com/ershoufang/c${id}/`
   	var { data: html } = await axios.get(buyLink)
  	var $ = cheerio.load(html)
  	var list = $('.sellListContent li').toArray()
   	list = list.map(item => {
		var title = $(item).find('.title a').text()
		var price = $(item).find('.totalPrice span').text()
    var houseInfo = $(item).find('.houseInfo').text()
    houseInfo = this.parseHouseInfo(houseInfo)
		var link = $(item).find('.title a').attr('href')
		var key = name + ' - ' + parseInt(houseInfo.mianji / 5) * 5
		title = title.trim()
		price = parseFloat(price)
		return { title, price, key, link, houseInfo }
  	})
  	list = list.filter(item => item.title)
  	return list
  }

  mergeData(data) {
  	var ret = {}
  	function buildKey(key) {
  		ret[key] = ret[key] || {}
  		ret[key].zu = ret[key].zu || []
  		ret[key].buy = ret[key].buy || []
  	}
  	data.map(item => {
  		item.zuList.map(item => {
  			buildKey(item.key)
  			ret[item.key].zu.push(item.price)
  		})
  		item.buyList.map(item => {
        buildKey(item.key)
  			ret[item.key].buy.push(item.price)
  		})
  	})
  	return ret
  }

  calcData(data) {
    var ret = []
    _.forIn(data, (val, key) => {
      val.buy = _.filter(val.buy, item => item > 100) // 去掉车位
      var zuAve = _.mean(val.zu)
      var buyAve = _.mean(val.buy)
      val.zushoubi = buyAve * 10000 / zuAve
      val.key = key
      if (val.zushoubi) {
        ret.push(val)
      }
    })
    ret.sort((a, b) => {
      return a.zushoubi > b.zushoubi ? 1 : -1
    })
    return ret
  }

  filterUsefulXiaoquList(xiaoquList) {
    _.each(xiaoquList, item => {
      item.zuList = item.zuList.filter(item => {
        var { houseInfo } = item
        if (houseInfo.infoShi >= 1 && houseInfo.infoTing >= 1) {
          return true
        }
        return false
      })
      item.buyList = item.buyList.filter(item => {
        var { houseInfo, price } = item
        if (houseInfo.infoShi >= 1 && houseInfo.infoTing >= 1) {
          // if (price >= 250 && price <= 400) {
          if (true) {
            return true
          }
        }
        return false
      })
    })
    return xiaoquList
  }

  async run() {
    var xiaoquList = _.range(1, 5)
    xiaoquList = await mapLimit(xiaoquList, async i => {
      return this.getXiaoquListByPage(i)
    }, MAP_LIMIT)
  	xiaoquList = _.flatten(xiaoquList)
    await fs.mkdirp(path.resolve(__dirname, 'output'))
  	await fs.writeFile(path.resolve(__dirname, 'output', 'xiaoqu.json'), JSON.stringify(xiaoquList, 0, 2))
    xiaoquList = this.filterUsefulXiaoquList(xiaoquList)
  	var merged = this.mergeData(xiaoquList)
    var calced = this.calcData(merged)
    await fs.writeFile(path.resolve(__dirname, 'output', 'zushoubi.json'), JSON.stringify(calced, 0, 2))
  }
}

function run() {
  var spider = new Spider()
  spider.run()
}

run()

function mapLimit (arr, fn, limit = Infinity) {
  return new Promise((resolve, reject) => {
    var ret = []
    var startCount = 0; var execCount = 0; var doneCount = 0
    var hasDone, hasStart

    function exec () {
      for (let i = startCount; i < arr.length; i++) {
        if (execCount >= limit) return
        hasStart = true
        execCount++
        startCount++
        fn(arr[i], i).then(val => {
          if (hasDone) { return }
          execCount--
          doneCount++
          ret[i] = val
          if (doneCount === arr.length) {
            hasDone = true
            resolve(ret)
          } else {
            exec()
          }
        }).catch(err => {
          hasDone = true
          return reject(err)
        })
      }
    }

    if (arr && arr.length) {
      exec()
    }

    if (!hasStart) resolve(null) // empty
  })
}