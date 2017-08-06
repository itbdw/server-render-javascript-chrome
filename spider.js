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

    // 开启一个子进程，启动 chrome todo 每次请求启动进程改为设计一个进程池
    get_port().then(chrome_port => {

        // 不要用 Ubuntu默认的 chromium 很慢
        // var chrome_path="google-chrome-stable";
        var chrome_path="/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome";

        // var chrome_path="chrome";

        var chrome = child_process.spawn(chrome_path, ['--headless', '--disable-gpu', '--remote-debugging-port=' + chrome_port, '--blink-settings=imagesEnabled=false']);

        console.log('started chrome instance with port:' + chrome_port);

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
            console.error('stderr: ' + url + "\n" + data.toString());
        });

        craw.on('uncaughtException', function (err) {
            console.error((err && err.stack) ? err.stack : err);

            chrome.kill();
            console.log('killed chrome instance when exception found with port:' + chrome_port);

            res.statusCode = 503;
            res.send('Error');
        });

        // 监听子进程退出事件
        craw.on('exit', function (code) {

            chrome.kill();
            console.log('killed chrome instance normally with port:' + chrome_port);

            switch (code) {
                case 1:
                    console.log('加载失败: ' + url);
                    res.statusCode = 502;
                    res.send('加载失败');
                    break;
                case 2:
                    console.log('加载超时: ' + url);
                    res.statusCode = 504;
                    res.send(content);
                    break;
                case 3:
                    console.log('禁止访问: ' + url);
                    res.statusCode = 403;
                    res.send(content);
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
                        res.header("Location", redirectUrl);
                        res.send("redirect to " + redirectUrl + "\n");
                        return;
                    }

                    content = content_split.join("\n");

                    res.send(content);
                    break;
            }
        });

    });
});

port = process.env.PORT || 3000;

app.listen(port, function () {
    console.log('server-render-javascript app start listening on port ' + port + '!');
});

