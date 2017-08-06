var express = require('express');
var base64 = require('base-64');
var child_process = require('child_process');
var get_port = require('get-port');

var app = express();

app.enable('trust proxy');

app.get('/*', function (req, res) {

    // 完整URL
    var url = req.protocol + '://' + req.hostname + req.originalUrl;

    var ua = base64.encode(req.headers['user-agent']);

    // 预渲染后的页面字符串容器
    var content = '';

    // 开启一个子进程，启动 chrome
    get_port().then(function (chrome_port) {

        // 不要用 Ubuntu 默认的 chromium, 很慢

        var chrome_path="chrome";

        // var chrome_path="google-chrome-stable";
        // var chrome_path="/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome";

        var chrome = child_process.spawn(chrome_path, ['--headless', '--disable-gpu', '--remote-debugging-port=' + chrome_port, '--blink-settings=imagesEnabled=false']);

        chrome.stderr.on('data', function (data) {
            console.error('chrome error: '  + url + " " + data.toString());
        });

        console.log('start chrome instance with port:' + chrome_port);

        //todo 需要保证 chrome 已经正常启动再开启进程
        // 再开启一个子进程，监听 chrome
        var craw = child_process.spawn('node', ['craw.js', url, ua, chrome_port]);

        // 设置stdout字符编码
        craw.stdout.setEncoding('utf8');

        // 监听的stdout，并拼接起来
        craw.stdout.on('data', function (data) {
            content += data.toString();
        });

        craw.stderr.on('data', function (data) {
            console.error('craw error: ' + url + " " + data.toString());
        });

        craw.on('close', function (code)  {
            if (code != 0) {
                console.log(`craw process exited with code ${code}`);
            }
        });

        // 监听子进程退出事件
        craw.on('exit', function (code) {

            chrome.kill();
            console.log('kill chrome instance normally with port:' + chrome_port);

            switch (code) {
                case 1:
                    console.log('加载失败: ' + url);
                    res.statusCode = 502;
                    res.send( content ? content : '加载失败');
                    break;
                case 2:
                    console.log('访问失败: ' + url);
                    res.statusCode = 503;
                    res.send( content ? content : '服务器内部错误');
                    break;
                case 3:
                    console.log('禁止访问: ' + url);
                    res.statusCode = 403;
                    res.send( content ? content : '禁止访问');
                    break;
                default:

                    var content_split = content.split("\n");

                    if (content_split[0] === '' || content_split[0] === undefined) {
                        console.error('执行异常，没有获取到状态码: ' + url);
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
                            console.error(e);
                            console.log('加载失败: ' + url);
                            res.statusCode = 502;
                            res.header("Content-Type", "text/html");
                            res.send( content ? content : '加载失败');
                            return;
                        }
                    }

                    content = content_split.join("\n");

                    res.send(content);
                    break;
            }
        });

    });

    //     need res.send on error

    // process.on("uncaughtException", function (err) {
    //     console.error('Error caught in uncaughtException event:', err);
    //
    // })

});

port = process.env.PORT || 3000;

app.listen(port, function () {
    console.log('server-render-javascript-chrome start listening on port ' + port);
});

