const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs-extra')
const path = require('path')
const _ = require('lodash')

const MAP_LIMIT = 2

class Spider {
  constructor() {

  }

  async getXiaoquListByPage(page) {
    console.log(`抓取第${page}页小区`)
  	var { data: html } = await axios.get(`https://bj.ke.com/xiaoqu/pg${page}`)
  	var $ = cheerio.load(html)
  	var list = $('.listContent li').toArray()
  	list = list.slice(0, 1)
  	list = await mapLimit(list, async item => {
		var name = $(item).find('.title a').text()
		var id = $(item).attr('data-id')
  		var zuList = await this.getZuList(id, name)
  		var buyList = await this.getBuyList(id, name)
		return { name, id, zuList, buyList }
  	}, MAP_LIMIT)
  	return list
  }

  async getZuList(id, name) {
  	var zuLink = `http://bj.zu.ke.com/zufang/c${id}/`
  	var { data: html } = await axios.get(zuLink)
  	var $ = cheerio.load(html)
  	var list = $('.content__list .content__list--item').toArray()
   	list = list.map(item => {
		var title = $(item).find('.content__list--item--title a').text()
		var price = $(item).find('.content__list--item-price em').text()
		var prop = $(item).find('.content__list--item--des').text()
		var link = $(item).find('.content__list--item--title a').attr('href')
		link = 'https://bj.zu.ke.com' + link
		var mianji = /[\d\.]+㎡/.exec(prop) || []
		mianji = parseFloat(mianji[0])
		var key = name + ' - ' + parseInt(mianji / 5) * 5
		title = title.trim()
    prop = prop.trim().split(/[|/]/).map(item => item.trim())
		price = parseFloat(price)
		return { title, price, mianji, key, link, prop }
  	})
  	list = list.filter(item => item.title)
  	return list
  }

  async getBuyList(id, name) {
  	var buyLink = `https://bj.ke.com/ershoufang/c${id}/`
   	var { data: html } = await axios.get(buyLink)
  	var $ = cheerio.load(html)
  	var list = $('.sellListContent li').toArray()
   	list = list.map(item => {
		var title = $(item).find('.title a').text()
		var price = $(item).find('.totalPrice span').text()
		var prop = $(item).find('.houseInfo').text()
		var link = $(item).find('.title a').attr('href')
		var mianji = /[\d\.]+平米/.exec(prop) || []
		mianji = parseFloat(mianji[0])
		var key = name + ' - ' + parseInt(mianji / 5) * 5
		title = title.trim()
		prop = prop.trim().split(/[|/]/).map(item => item.trim())
		price = parseFloat(price)
		return { title, price, mianji, key, link, prop }
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

  async run() {
    var xiaoquList = _.range(1, 2)
    xiaoquList = await mapLimit(xiaoquList, async i => {
      return this.getXiaoquListByPage(i)
    }, MAP_LIMIT)
  	xiaoquList = _.flatten(xiaoquList)
  	await fs.writeFile(path.resolve(__dirname, 'xiaoqu.json'), JSON.stringify(xiaoquList, 0, 2))
  	var merged = this.mergeData(xiaoquList)
    var calced = this.calcData(merged)
    await fs.writeFile(path.resolve(__dirname, 'zushoubi.json'), JSON.stringify(calced, 0, 2))
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