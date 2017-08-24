var express = require('express');
var base64 = require('base-64');
var child_process = require('child_process');
var chrome_launcher = require('chrome-launcher');

var app = express();

var request_id = 'init';
//fixme 客户端连接异常断开后，没有捕获

var url = '';

//请求超时时间 = sleep_ms * loop_count + totalTimeout

var totalTimeout = 5000;//ms //设置开始处理请求后的超时时间
var sleep_ms = 100;//ms 没有空闲进程的等待下次查询时间的毫秒数
var loop_count = 20; //循环查几次直到放弃


var instanceType = 'dynamic';// 进程数静态还是动态调整，static dynamic

//设置 chrome 进程数
var chromeInstanceCount = 3;//注意提前计算好每个 chrome 进程最坏情况的内存占用情况，可能20次请求就涨到400M
var maxChromeInstanceCount = 4;//最大数量，注意，这个值会被突破，仅当 static 情况下有意义

var maxRequestCount = 20;// chrome 进程执行超过这个数后即销毁，chrome 太吃内存

var chromePools = {}; // {"chrome":chrome, "status":"free"}

initInstance(request_id);

//虽然很浪费 cpu，暂时没有更好的方法来解决
function sleep(d){
    for(var t = Date.now();Date.now() - t <= d;);
}

/**
 * Launches a debugging instance of Chrome.
 * @param {boolean=} headless True (default) launches Chrome in headless mode.
 *     False launches a full version of Chrome.
 * @return {Promise<ChromeLauncher>}
 */
function launchChrome(headless = true) {
    return chrome_launcher.launch({
        // port: 9222,// just use a random port
        chromeFlags: [
            headless ? '--headless' : '',
            '--window-size=1024,768',//may be should vary with device type
            '--disable-gpu',
            '--blink-settings=imagesEnabled=false'
        ]
    });
}

function initInstance(request_id) {
    for (var x = 0; x < chromeInstanceCount; x++) {
        createChromeInstance(request_id);
    }
}

function addInstance(instance) {
    chromePools["port" + instance.chrome.port] = instance;
}

function delInstance(instance, request_id) {
    console.log(formatDateTime(request_id) + ' ' + 'delete chrome instance start with port:' + instance.chrome.port + " after maxRequestCount:" + maxRequestCount);
    delete chromePools["port" + instance.chrome.port];

    instance.chrome.kill();
    console.log(formatDateTime(request_id) + ' ' + 'delete chrome instance done with port:' + instance.chrome.port + " after maxRequestCount:" + maxRequestCount);
}

function freeInstance(instance, request_id) {

    if (instance && instance.chrome && chromePools["port" + instance.chrome.port]) {
        var enough = clearSpareInstance(instance);

        console.log(formatDateTime(request_id) + ' ' + 'free chrome instance with port:' + instance.chrome.port, chromePools["port" + instance.chrome.port]["count"]);

        if (chromePools["port" + instance.chrome.port]["count"] >= maxRequestCount) {

            if (!enough) {
                createChromeInstance(request_id);
            }

            delInstance(instance, request_id);
        } else {
            chromePools["port" + instance.chrome.port]["status"] = "free";
        }

    } else {
        console.log(formatDateTime(request_id) + ' ' + 'free chrome instance with port:null failed');
    }
}


function useInstance(instance, request_id) {
    chromePools["port" + instance.chrome.port]["status"] = "used";
    chromePools["port" + instance.chrome.port]["count"]++;
}

function createChromeInstance(request_id) {
    var instance;

    console.log(formatDateTime(request_id) + " try create a new chrome instance");
    launchChrome().then((chrome) => {

        instance = {
            "chrome": chrome,
            "status": "free",
            "count": 0,
        };

        addInstance(instance);

        console.log(formatDateTime(request_id) + ' ' + 'start chrome instance with port:' + chrome.port);
    }).catch((error) => {
        console.error(formatDateTime(request_id) + ' ' + 'start chrome failed: ', error);
    });

    return instance;
}

/**
 * Randomize array element order in-place.
 * Using Durstenfeld shuffle algorithm.
 *
 * @link https://stackoverflow.com/a/12646864/5049871
 */
function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}

// 必须要声明 var 内部变量，否则会被别的请求使用，导致错误的释放进程池
function getValidInstance(request_id) {
    var instance;

    for (var i=0; i <= loop_count; i++) {
        instance = getValidInstanceReal(request_id, i);

        if (instance && instance.status) {
            return instance;
        }

        sleep(sleep_ms);
    }

    return null;
}

function getValidInstanceReal(request_id, i) {

    var instance;
    var poolKeys = Object.keys(chromePools);

    poolKeys = shuffleArray(poolKeys);

    for (var x in poolKeys) {
        if (chromePools[poolKeys[x]].status == "free") {
            instance = chromePools[poolKeys[x]];
            useInstance(instance, request_id);
            break;
        } else {
            // console.log(request_id, poolKeys[x], 'used')
        }
    }

    if (instanceType == 'dynamic' && i == 1 && !instance && poolKeys.length < maxChromeInstanceCount) {
        createChromeInstance(request_id);
    }

    return instance;
}

function clearSpareInstance() {
    var enough = false;

    if (instanceType != 'dynamic') {
        return enough;
    }

    var instance;
    var poolKeys = Object.keys(chromePools);

    if (poolKeys.length > chromeInstanceCount) {
        var should_delete_count = maxChromeInstanceCount - chromeInstanceCount;
        var delete_count = 0;
        enough = true;

        for (var x in poolKeys) {
            if (chromePools[poolKeys[x]].status == "free" && chromePools[poolKeys[x]].count > maxRequestCount
            ) {
                instance = chromePools[poolKeys[x]];
                delInstance(instance, request_id);

                delete_count++;
                if (delete_count === should_delete_count) {
                    break;
                }
            }
        }
    }
    return enough;
}

function formatDateTime(req_id='') {
    var date = new Date();

    var y = date.getFullYear();
    var m = date.getMonth() + 1;
    m = m < 10 ? ('0' + m) : m;
    var d = date.getDate();
    d = d < 10 ? ('0' + d) : d;
    var h = date.getHours();
    h = h < 10 ? ('0' + h) : h;
    var minute = date.getMinutes();
    var second = date.getSeconds();
    var ms = date.getMilliseconds();
    minute = minute < 10 ? ('0' + minute) : minute;
    second = second < 10 ? ('0' + second) : second;

    return y + '-' + m + '-' + d + ' ' + h + ':' + minute + ':' + second + '.' + ms + ' ' + req_id;
};

function getRequestId() {
    return (new Date().getTime()).toString(16);
}

app.enable('trust proxy');

app.get('/*', function (req, res) {

    request_id = getRequestId();
    url = req.protocol + '://' + req.hostname + req.originalUrl;

    request_id = request_id + ' ' + url;

    var ua = base64.encode(req.headers['user-agent']);

    var content = '';

    console.log(formatDateTime(request_id) + ' ' + 'deal request ' + url);

    var instance = getValidInstance(request_id);

    if (instance && instance.chrome) {

        console.log(formatDateTime(request_id) + ' ' + 'choose chrome instance with port:' + instance.chrome.port);

        var craw = child_process.spawn('node', ['craw.js', url, ua, instance.chrome.port]);

        //设置进程超时
        setTimeout(function () {
            craw.kill()
        }, totalTimeout);

        craw.stdout.setEncoding('utf8');

        craw.stdout.on('data', function (data) {
            content += data.toString();
        });

        craw.stderr.on('data', function (data) {
            console.error(formatDateTime(request_id) + ' ' + 'craw error: ' + url + " " + data.toString());
        });

        craw.on('close', function (code) {
            if (code != 0) {
                console.log(formatDateTime(request_id) + ' ' + `craw process exited with code ${code}`);
            }
        });

        craw.on('exit', function (code) {

            freeInstance(instance, request_id);

            switch (code) {
                case 1:
                    console.log(formatDateTime(request_id) + ' ' + '加载失败: ' + url);
                    res.statusCode = 502;
                    res.send(content ? content : '加载失败');
                    break;
                case 2:
                    console.log(formatDateTime(request_id) + ' ' + '访问失败: ' + url);
                    res.statusCode = 503;
                    res.send(content ? content : '服务器内部错误');
                    break;
                case 3:
                    console.log(formatDateTime(request_id) + ' ' + '禁止访问: ' + url);
                    res.statusCode = 403;
                    res.send(content ? content : '禁止访问');
                    break;
                case 0:

                    var content_split = content.split("\n");

                    if (content_split[0] === '' || content_split[0] === undefined) {
                        console.error(formatDateTime(request_id) + ' ' + '执行异常，没有获取到状态码: ' + url);
                        res.statusCode = 503;
                        res.send(content);
                        return;
                    }

                    var status = content_split[0];
                    var contentType = content_split[1];
                    var redirectUrl = content_split[2];

                    res.statusCode = status;
                    res.header("Content-Type", contentType);

                    content_split.shift();
                    content_split.shift();
                    content_split.shift();

                    if (redirectUrl) {

                        try {
                            res.header("Location", redirectUrl);
                            res.send("redirect to " + redirectUrl + "\n");
                            return;
                        } catch (e) {
                            console.error(formatDateTime(request_id) + ' ' + e);
                            console.log(formatDateTime(request_id) + ' ' + '加载失败: ' + url);
                            res.statusCode = 502;
                            res.header("Content-Type", "text/html");
                            res.send(content ? content : '加载失败');
                            return;
                        }
                    }

                    content = content_split.join("\n");

                    res.send(content);
                    break;

                default:
                    console.log(formatDateTime(request_id) + ' ' + '访问超时: ' + url);
                    res.statusCode = 504;
                    res.send(content ? content : '访问超时 ' + url);
                    break;
            }
        });
    } else {
        console.log(formatDateTime(request_id) + ' ' + '服务器没有空闲 chrome 进程: ' + url);
        res.statusCode = 504;
        res.send(content ? content : '访问超时 ' + url);
    }
});

//     need res.send on error
process.on("uncaughtException", function (err) {
    console.error(formatDateTime(request_id) + ' ' + 'Spider error caught in uncaughtException event:', err);
})

process.on("error", function (err) {
    console.error(formatDateTime(request_id) + ' ' + 'Spider error:', err);
})

port = process.env.PORT || 3000;


app.listen(port, function () {
    console.log(formatDateTime(request_id) + ' ' + 'server-render-javascript-chrome start listening on port ' + port);
});
