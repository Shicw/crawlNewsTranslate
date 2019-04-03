const request = require('request');
const cheerio = require('cheerio');
const Promise = require('bluebird');
const querystring = require('querystring');
Promise.promisifyAll(request, { suffix: 'Async' });  //suffix 自定义 get --> getSC
const mysql = require('promise-mysql');

let newsArray = [];
/**
 * 获取geekwire上今日新闻
 */
 async function getNews(){
 	let keyword = 'driving';//设置搜索关键词
 	let response = null;
 	try{
 		response = await request.getAsync({
 			url:'https://www.geekwire.com/?s='+keyword+'&orderby=date&order=DESC',
 			headers: {
 				'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36',
 				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7',
 				'Cache-Control': 'no-cache'
 			}
 		});
 	}catch (e){}
 	if(response && response.statusCode==200){
 		$ = cheerio.load(response.body);//获取html
 		let alertWarning = $(".alert-warning");//若关键词搜索不到内容会有该元素提示
 		if(alertWarning.length>0) {
            console.error('关键词搜索结果为空');
            return;
        }
        //获取article标签
        $("article").each(function (i, element) {
            //获取新闻发布时间
            let publishTime = $(element).find('time');
            if(publishTime.length==0){
                //console.error('找不到新闻的time标签');
                return;
            }
            publishTime = publishTime.eq(1).attr('datetime');//新闻发布时的0时区时间
            publishTime = new Date(publishTime).setHours(0, 0, 0, 0) /1000;
            let todayBegin = new Date().setHours(0, 0, 0, 0)/1000;
            if (publishTime == todayBegin) {
                let a = $(element).find('h2').find('a');
                if(a.length==0){
                    return;
                }
                let thumbnail = $(element).find('img').attr('src');//获取缩略图
                let href = a.attr('href');//获取新闻连接
                let title = a.text();//获取新闻标题
                newsArray.push({title,href,thumbnail});
            }
        });
 		console.log('新闻列表加载成功,共加载'+newsArray.length+'篇');
 		//循环按所需数量来获取详情并翻译
        //TODO 循环会并行执行全部getNewsDetail
        if(newsArray.length>0){
            for(let i=0;i<1;i++){
                let news = newsArray[i];
                getNewsDetail(news.href,news.title,news.thumbnail,i);
            }
        }
 	}
 }
/**
 * 判断新闻是否存在
 * @param  {string} title
 * @return {int} 0:不存在 1:存在
 */
async function checkRepeat(title){
    let conn;
    try {
        conn = await mysql.createConnection({
            host:'',
            user:'',
            password:'',
            database:'',
        });
    } catch (e) {
        console.error(e);
    }

    let result;
    try {
        result = await conn.query("SELECT id FROM cmf_portal_post WHERE post_title='"+title+"'");
    } catch (e) {
        console.error(e);
    }
    try {
        await conn.end();
    } catch (e) {
        console.error(e);
    }
    return result.length==0 ? 0 : 1;
}
/**
 * 获取新闻详情并翻译
 * @param {string} href 新闻详情链接
 * @param {string} title 新闻标题
 * @param {string} thumbnail 缩略图
 * @param {int} i 循环索引
 */
async function getNewsDetail(href,title,thumbnail,i){
    //翻译标题
    title = await translator(title);
    title = title.content;
    //根据标题判断是否已发布过
    let exist = 0;
    //exist = checkRepeat(title);
    if(!exist) {
        try {
            response = await request.getAsync({
                url: href,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7',
                    'Cache-Control': 'no-cache'
                }
            });
        } catch (e) {
            console.error(e);
        }
        if (response && response.statusCode == 200) {
            console.log('第' + (i + 1) + '篇新闻详情获取成功');

            $ = cheerio.load(response.body);
            let content = $(".entry-content").html();
            content = content.replace(/<blockquote[^>]*>[\s\S]*<\/blockquote[^>]*>/gis, "");//去除多余的内容
            $ = cheerio.load(content);

            $("iframe").remove();
            $("figure").attr('style', '');
            $("figcaption").remove();
            $("img").attr('width', '').attr('height', '');
            //设置计数器
            let counter = 0;
            //定时循环每一个p段落进行翻译,然后将译文替换到原html中
            let p = $("p");
            let timer = setInterval(async function () {
                if (counter < p.length) {
                    console.log('正在翻译第' + (counter + 1) + '段');
                    let result = await translator(p.eq(counter).text());//翻译
                    if (result.code == 1) {
                        p.eq(counter).text(result.content);//译文替换到原html中
                        counter++;
                    }
                } else {
                    clearInterval(timer);
                    console.log('翻译完成,正在发布新闻');
                    publishNews(title, $("body").html(), thumbnail);
                }
            }, 2000);
        }
    }else{
        console.error('文章已发布过');
    }
}
/**
 * 发布新闻,插入数据库
 * @param title
 * @param content
 * @param thumbnail
 */
async function publishNews(title,content,thumbnail) {
    let conn;
    try {
        conn = await mysql.createConnection({
            host:'',
            user:'',
            password:'',
            database:'',
        });
    } catch (e) {
        console.error(e);
    }
    let nowTime = parseInt(new Date() / 1000);
    let more = "{\"thumbnail\":\"" + thumbnail + "\",\"template\":\"\"}";


    let result1;
    try {
        result1 = await conn.query("INSERT INTO cmf_portal_post (user_id,create_time,update_time,published_time,post_title,post_source,post_content,more) " +
            "VALUES (?,?,?,?,?,?,?,?)", [396, nowTime, nowTime, nowTime, title, 'geekwire.com', content, more]);
    } catch (e) {
        console.error(e);
    }

    let newsId = result1.insertId;

    if (newsId > 0) {
        //cmf_portal_category_post表创建新闻类别和新闻的关系记录
        try {
            let result2 = await conn.query("INSERT INTO cmf_portal_category_post (post_id,category_id) VALUES (?,?)", [newsId, 5]);
        } catch (e) {
            console.error(e);
        }
        console.log('发布成功');
    }
    try {
        await conn.end();
    } catch (e) {
        console.error(e);
    }
}
/**
 * 获取tk
 * @param a
 * @returns {string}
 */
function token(a) {

    var k = "";
    var b = 406644;
    var b1 = 3293161072
        var jd = ".";
    var sb = "+-a^+6";
    var Zb = "+-3^+b+-f";

    for (var e = [], f = 0, g = 0; g < a.length; g++)
    {
        var m = a.charCodeAt(g);
        128 > m ? e[f++] = m : (2048 > m ? e[f++] = m >> 6 | 192 : (55296 == (m & 64512) && g + 1 < a.length && 56320 == (a.charCodeAt(g + 1) & 64512) ? (m = 65536 + ((m & 1023) << 10) + (a.charCodeAt(++g) & 1023), e[f++] = m >> 18 | 240, e[f++] = m >> 12 & 63 | 128) : e[f++] = m >> 12 | 224, e[f++] = m >> 6 & 63 | 128), e[f++] = m & 63 | 128)
    }
    a = b;
    for (f = 0; f < e.length; f++) a += e[f], a = RL(a, sb);
    a = RL(a, Zb);
    a ^= b1 || 0;
    0 > a && (a = (a & 2147483647) + 2147483648);
    a %= 1E6;
    return a.toString() + jd + (a ^ b)

}

/**
 * 添加连接符
 * @param a
 * @param b
 * @returns {*}
 * @constructor
 */
function RL(a, b) {
    var t = "a"; var Yb = "+";
    for (var c = 0; c < b.length - 2; c += 3) {
        var d = b.charAt(c + 2), d = d >= t ? d.charCodeAt(0) - 87 : Number(d), d = b.charAt(c + 1) == Yb ? a >>> d: a << d;
        a = b.charAt(c) == Yb ? a + d & 4294967295 : a ^ d
    }
    return a
}

/**
 * 翻译
 * @param content
 * @param from
 * @param to
 * @returns {Promise.<*>} 状态码和内容
 */
async function translator(content,from="en",to="zh-CN") {
    let tk = token(content);
    let query = {
        client:"t",
        sl:from,
        tl:to,
        hl:"zh-CN",
        dt:"at",
        dt:"bd",
        dt:"ex",
        dt:"ld",
        dt:"md",
        dt:"qca",
        dt:"rw",
        dt:"rm",
        dt:"ss",
        dt:"t",
        ie:"UTF-8",
        oe:"UTF-8",
        source:"btn",
        ssel:"0",
        tsel:"0",
        kc:"0",
        tk:tk,
        q:content
    };
    let querystr = querystring.stringify(query);
    let response = await request.getAsync({
        url:"http://translate.google.cn/translate_a/single?"+querystr,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        }
    });
    if(response.statusCode == 200){
        //console.log(JSON.parse(response.body)[0][0][0]);
        return {
            code:1,
            content:JSON.parse(response.body)[0][0][0]
        }
    }else{
        return {
            code:0,
            content:"网络连接失败"
        }
    }
}
getNews();
