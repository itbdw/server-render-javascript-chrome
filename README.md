
:warning::warning::warning::warning::warning::warning::warning::warning::warning::warning:
:warning::warning::warning::warning::warning::warning::warning::warning::warning::warning:
:warning::warning::warning::warning::warning::warning::warning::warning::warning::warning:
:warning::warning::warning::warning::warning::warning::warning::warning::warning::warning:

Do not try this!

不要尝试！

:warning::warning::warning::warning::warning::warning::warning::warning::warning::warning:
:warning::warning::warning::warning::warning::warning::warning::warning::warning::warning:
:warning::warning::warning::warning::warning::warning::warning::warning::warning::warning:
:warning::warning::warning::warning::warning::warning::warning::warning::warning::warning:


# server-render-javascript-chrome
Prerender your javascript web page for better seo with Google Chrome.

## Dependency

 Must 

`Chrome`

`NodeJS`

Suggested

`pm2`, start the server and much more.

## Install

> Suppose you are using a Ubuntu Server and nginx as web server.

1. NodeJS

```
curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -

sudo apt-get install -y nodejs

```

2. Chrome (need the latest stable version for better performance)

```
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
dpkg -i google-chrome-stable_current_amd64.deb
apt-get install -f

apt install libosmesa6
ln -s /usr/lib/x86_64-linux-gnu/libOSMesa.so.6 /opt/google/chrome/libosmesa.so
```

3. Install and Run

Download this code to your server, say `/var/server/spider`, the directory
structure looks like below

```
/var/server/spider/
                    craw.js
                    package.json
                    spider.js

```

```
cd /var/server/spider
npm install

npm install pm2 -g 
PORT=3000 pm2 -f start spider.js
```

after started, you can use `pm2 logs` to monitor logs, `pm2 list` to display services and much more.


4. Proxy Request

I suppose you use nginx as web server and run the nodejs and nginx at same server.

```
upstream spider {
    server localhost:3000;
}

server {
    ...
    
    
    set $is_spider 0;
    set $is_server_render 0;

    if ($http_user_agent ~ Baiduspider) {
       set $is_spider 1;
    }

    if ($http_user_agent ~ Googlebot) {
       set $is_spider 1;
    }

    if ($http_user_agent ~ ServerRender) {
       set $is_server_render 1;
    }

    set $is_spider_is_render $is_spider$is_server_render;

    location / {
        ...        
    
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        if ($is_spider_is_render = 10) {
             proxy_pass http://spider;
        }

        ...
    }
    ...
}
```

After changing nginx config, don't forget reload the nginx.

You can make a request and check your nginx access log if anything works great.

`curl -A 'fake Googlebot by server-render-javascript' http://yourwebsite.com/abc`

You should get two line in nginx access log, one is your request with user-agent `fake Googlebot by server-render-javascript` and one made by
your upstream server with user-agent `ServerRenderJavascript`, if you have not change the default user-agent at craw.js.


## What and how it works

Your website is rendered with javascript. But search engine (like Baidu, Sogou, 360) does not like the page, and `even` can not understand javascript content totally.


So, why don't we run a browser on the server side. When spider like Googlebot comes to your website,
proxy the request to a upstream server, why not `nodejs server`, and the upstream server deal the request
with a headless browser and make a new request just like the we human visit website by Safari or Chrome and return the
rendered content back.

The workflow looks like this

```
GoogleBot => Web Server => NodeJS Server => Make A Request Again With Server Browser => Get Web Content And Return
```

