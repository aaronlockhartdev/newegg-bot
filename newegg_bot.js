const undici = require('undici');
const puppeteer = require('puppeteer-extra');
const config = require('./config/puppeteer.json');

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// add recaptcha solver
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
puppeteer.use(
    RecaptchaPlugin({
      provider: { id: '2captcha', token: config.vars.two_captcha_token },
      visualFeedback: true // colorize reCAPTCHAs (violet = detected, green = solved)
    })
);

// shim Promise.any if unsupported
var any = require('promise.any');
any.shim();


// simple async delay function 
function delay(time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time);
    });
}

// random async delay function
function delayRandom(timeMin, timeMax) {
    return new Promise(function(resolve) {
        setTimeout(resolve, random(timeMin, timeMax));
    });
}

function random(min, max) {
    return Math.random() * (max - min) + min;
}

// define constants
const baseURL = "https://www.newegg.com/";

class NeweggBot {
    constructor(browser) {
        this.context = browser;
    }
    async _init() {
        if (config.verbose) console.log("Opening new page...");
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(0);
    }
    async _solveCaptcha() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const p = this.page;
        
        await delay(2000);
        if (p.url().search(/areyouahuman/i) != -1) {
            if (config.verbose) console.log("Catpcha detected, solving...");
            await p.solveRecaptchas();
            await delay(2000);
            await Promise.all([
                p.waitForNavigation(),
                p.solveRecaptchas()
            ]);
            
        }
        
    }
}
class NeweggSignInBot extends NeweggBot{
    async run() {
        await this._init();
        await this._signIn();
    }
    async _signIn() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const s = config.selectors.sign_in;
        const v = config.vars;
        const p = this.page;

        // go to newegg.com
        if (config.verbose) console.log(`Going to ${baseURL}...`);
        console.log(p)
        await p.goto(baseURL);
        
        // check for/solve captcha
        await this._solveCaptcha();

        // sign in
        if (config.verbose) console.log("Signing in...");
        // go to sign in URL (changes, so must be retrieved each time)
        await p.waitForSelector(s.link);
        const signInURL = await p.$eval(s.link, el => el.getAttribute("href"));
        await p.goto(signInURL);
        
        // check for/solve captcha
        await this._solveCaptcha();

        // wait until button is clickable
        async function checkButton() {
            async function getButtonColor() {
                return await p.evaluate(() => {
                    const btn = document.querySelector("#signInSubmit");
                    return JSON.parse(JSON.stringify(getComputedStyle(btn))).background.search("rgb(255, 163, 58)") != -1;
                });
            }
            while (await getButtonColor()) { /* pass */ }
        }
        
        // sign in with email and password
        await p.waitForSelector(s.email);
        await p.type(s.email, v.email, {delay: random(5, 9)});
        await delayRandom(500, 1000);
        await p.click(s.continue);
        try {
            await p.waitForSelector(s.passwd, {timeout: 10000});
            await p.type(s.passwd, v.passwd), {delay: random(5, 9)};
        } catch (e) {
            console.log("Password not found, maybe you have to input a code?");
        }
        // TODO: ADD COMMAND LINE CODE ENTRANCE AND BLOCKING UNTIL THE CODE IS ENTERED!!
        // FUTURE: POSSIBLY ADD EMAIL INTEGRATION FOR DIRECT CODE INPUT
        await delayRandom(500, 1000);
        await Promise.all([
            p.waitForNavigation(),
            p.click(s.continue),
        ]);
        
        // check for/solve captcha
        await this._solveCaptcha();
    }
}
class NeweggMonitorBot extends NeweggBot{
    constructor(browser, productURL) {
        super(browser);
        this.productURL = productURL;
        this.combo = productURL.search(/combodeal/i) != -1;
    }
    async run() {
        await this._init();
        await this._monitorProduct();
        await this._addProductToCart();
        await this._checkout()
    }
    async _monitorProduct() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const p = this.page;
        const s = config.selectors.monitor;

        if (config.verbose) console.log(`Going to ${this.productURL}`);
        await p.goto(this.productURL);
        
        // check for/solve captcha
        await this._solveCaptcha();
        
        if (config.verbose) console.log("Monitoring status...");
        const client = new undici.Client(baseURL);
        async function _checkStatusRequest(url) {
            return new Promise(function(resolve, reject) {
                setTimeout(() => {client.request({
                    "path": url,
                    "method": "GET",
                }, function (err, data) {
                    if (err) {
                        reject(err);
                    }
                  
                    const {
                        statusCode,
                        headers,
                        body
                    } = data;
                    
                    if (statusCode === 302) reject('302 returned');
                    if (statusCode !== 200 || !body) reject();
                    
                    let res = '';
                    body.setEncoding('utf8');
                    body.on('data', d => {
                        res += d;
                    });
                    body.on('end', () => {
                        // console.log(res);
                        // console.log(headers)
                        if (res.search(/add to cart/i) != -1) {
                            resolve(true);
                        }
                        resolve(false);
                    })
                })}, random(30, 40));
            });   
        }

        async function _checkStatusReload() {
            await p.reload();
            await Promise.any([
                p.waitForXPath(s.add_cart),
                p.waitForXPath(s.notify)
            ]);
            try {
                await Promise.all([
                    p.waitForNavigation(),
                    async () => {
                        const button = await p.$x(s.add_cart);
                        await button[0].click();
                    }
                ])
                return true;
            } catch (err) {
                return false;
            }
        }
        let count = 0;
        try {
            while (!(await _checkStatusRequest(this.productURL))){
                count++;
                if (config.verbose) process.stdout.write(`Item out of stock, attempt ${count}...\r`);
            }
            if (this.combo) {
                let string = "ItemList=Combo.";
                let index = this.productURL.search(string) + string.length;
                let id = this.productURL.slice(index, index + 7);
                await Promise.all([
                    p.waitForNavigation(),
                    p.evaluate((id) => {
                        Biz.Product.Cart.addCombo(id, '', '1', '0');
                    }, id)
                ]);
            } else {
                // TODO: add support for regular items, not just combos
            }
            if (config.verbose) console.log("Added product to cart!");
        } catch (err){
            client.close();
            if (err == '302 returned') {
                if (config.verbose) console.log("They're onto us! Try using a VPN. Switching to alternate (slower) stock detection system.");
            }
        }
        while (!(await _checkStatusReload())) {
            count++;
                if (config.verbose) process.stdout.write(`Item out of stock, attempt ${count}...\r`);
        }

    }
    async _checkout() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const s = config.selectors.checkout;
        const v = config.vars;
        const p = this.page;

        if (config.verbose) console.log("Checking out...");
        await p.waitForXPath(s.checkout);
        const checkout = await p.$x(s.checkout);
        await checkout[0].click();
        if (config.verbose) console.log("Delivery...");
        await p.waitForXPath(s.delivery);
        const delivery = await p.$x(s.delivery);
        await delivery[0].click();
        if (config.verbose) console.log("Payment...");
        await p.waitForXPath(s.payment);
        const payment = await p.$x(s.payment);
        await payment[0].click();
        await p.waitForSelector(s.csv);
        await p.type(s.csv, v.csv);
        if (config.verbose) console.log("Reviewing order...");
        await p.waitForXPath(s.review);
        const review = await p.$x(s.review);
        await review[0].click();

        // BE VERY CAREFUL WHEN TESTING, DO NOT UNCOMMENT THE FOLLOWING LINES
        // if (config.verbose) console.log("Placing order...");
        // await p.waitForXPath(s.place);
        // const place = await p.$x(s.place);
        // await place[0].click();
    }
}
(async () => {
    if (config.verbose) console.log("Opening incognito chromium browser...");
    const browser = await puppeteer.launch(config.launch_settings);
    const context = await browser.createIncognitoBrowserContext();
    let signInBot = new NeweggSignInBot(context);
    await signInBot.run();

    let monitorBots = [];
    for (let i = 0; i < config.products.length; i++) {
        monitorBots.push(new NeweggMonitorBot(context, config.products[i]).run());
    }
    await Promise.all(monitorBots);
})();