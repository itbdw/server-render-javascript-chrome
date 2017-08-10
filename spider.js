var express = require('express');
var base64 = require('base-64');
var child_process = require('child_process');
var chrome_launcher = require('chrome-launcher');

var app = express();

//设置一次请求的超时时间
var totalTimeout = 10000;//ms

//设置 chrome 进程数
var chromeInstanceCount = 2;//注意提前计算好每个 chrome 进程的内存占用情况


var chromePools = {}; // {"chrome":chrome, "status":"free"}

initInstance();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

function initInstance() {
    for (var x = 0; x < chromeInstanceCount; x++) {
        createChromeInstance();
    }
}

function addInstance(instance) {
    chromePools["port" + instance.port] = instance;
}

function freeInstance(instance) {
    chromePools["port" + instance.port]["status"] = "free";
}

function useInstance(instance) {
    chromePools["port" + instance.port]["status"] = "used";
}

function createChromeInstance() {
    var instance = {};

    console.log("try create a new chrome instance");
    launchChrome().then((chrome) => {

        instance = {
            "chrome": chrome,
            "status": "free",
        };

        addInstance(instance);

        console.log(formatDateTime() + ' ' + 'start chrome instance with port:' + chrome.port);
    }).catch((error) => {
        console.error(formatDateTime() + ' ' + 'chrome error: ', error);
    });

    return instance;
}

function getValidInstance(i = 0) {
    var instance = {};

    for (x in chromePools) {
        if (chromePools[x].status == "free") {
            instance = chromePools[x];

            useInstance(instance);
            break;
        }
    }

    //小心死循环
    if (!instance.status) {
        sleep(100);
        return getValidInstance(i);
    }

    return instance;
}

function formatDateTime(inputTime) {
    if (inputTime) {
        var date = new Date(inputTime);
    } else {
        var date = new Date();
    }

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

    return y + '-' + m + '-' + d + ' ' + h + ':' + minute + ':' + second + '.' + ms;
};

app.enable('trust proxy');

app.get('/*', function (req, res) {

    var url = req.protocol + '://' + req.hostname + req.originalUrl;

    var ua = base64.encode(req.headers['user-agent']);

    var content = '';

    console.log(formatDateTime() + ' ' + 'start deal request ' + url);

    //sync
    instance = getValidInstance();

    if (instance) {

        console.log(formatDateTime() + ' ' + 'choose chrome instance with port:' + instance.chrome.port + ' ' + url);

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
            console.error(formatDateTime() + ' ' + 'craw error: ' + url + " " + data.toString());
        });

        craw.on('close', function (code) {
            if (code != 0) {
                console.log(formatDateTime() + ' ' + `craw process exited with code ${code}`);
            }
        });

        craw.on('exit', function (code) {

            freeInstance(instance);

            console.log(formatDateTime() + ' ' + 'free chrome instance with port:' + instance.chrome.port + ' ' + url);

            switch (code) {
                case 1:
                    console.log(formatDateTime() + ' ' + '加载失败: ' + url);
                    res.statusCode = 502;
                    res.send(content ? content : '加载失败');
                    break;
                case 2:
                    console.log(formatDateTime() + ' ' + '访问失败: ' + url);
                    res.statusCode = 503;
                    res.send(content ? content : '服务器内部错误');
                    break;
                case 3:
                    console.log(formatDateTime() + ' ' + '禁止访问: ' + url);
                    res.statusCode = 403;
                    res.send(content ? content : '禁止访问');
                    break;
                case 0:

                    var content_split = content.split("\n");

                    if (content_split[0] === '' || content_split[0] === undefined) {
                        console.error(formatDateTime() + ' ' + '执行异常，没有获取到状态码: ' + url);
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
                            console.error(formatDateTime() + ' ' + e);
                            console.log(formatDateTime() + ' ' + '加载失败: ' + url);
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
                    console.log(formatDateTime() + ' ' + '访问超时: ' + url);
                    res.statusCode = 504;
                    res.send(content ? content : '访问超时 ' + url);
                    break;
            }
        });
    } else {
        console.log(formatDateTime() + ' ' + '服务器没有空闲 chrome 进程: ' + url);
        res.statusCode = 504;
        res.send(content ? content : '访问超时 ' + url);
    }
});

//     need res.send on error

// process.on("uncaughtException", function (err) {
//     console.error(formatDateTime() + ' ' + 'Error caught in uncaughtException event:', err);
//
// })

port = process.env.PORT || 3000;

app.listen(port, function () {
    console.log(formatDateTime() + ' ' + 'server-render-javascript-chrome start listening on port ' + port);
});
