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

function delay(time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
}

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
    async _init() {
        if (config.verbose) console.log("Opening new page...");
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(0);
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
        await p.type(s.email, v.email, {delay: 5});
        await delay(500);
        await p.click(s.continue);
        try {
            await p.waitForSelector(s.passwd, {timeout: 35000});
        } catch (e) {
            console.log("Password not found, maybe you have to input a code?");
        }
        await p.type(s.passwd, v.passwd), {delay: 5};
        await delay(500);
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
        this.combo = productURL.search(/combo/i) != -1;
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

        if (config.verbose) console.log(`Going to ${this.productURL}`);
        await p.goto(this.productURL);
        
        // check for/solve captcha
        await this._solveCaptcha();
        
        if (config.verbose) console.log("Monitoring status...");
        const client = new undici.Client(baseURL);
        async function _checkStatus(url) {
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
                    
                    if (statusCode !== 200 || !body) resolve(false);
                    
                    let res = '';
                    body.setEncoding('utf8');
                    body.on('data', d => {
                        res += d;
                    });
                    body.on('end', () => {
                        // console.log(res);
                        if (res.search(/add to cart/i) != -1) {
                            resolve(true);
                        }
                        resolve(false);
                    })
                })}, 10);
            });   
        }

        let count = 0;
        while (!(await _checkStatus(this.productURL))){
            count++;
            if (config.verbose) process.stdout.write(`Item out of stock, attempt ${count}...\r`);
        }
        client.close();
    }
    async _addProductToCart() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const s = config.selectors.sign_in;
        const v = config.vars;
        const p = this.page;

        if (this.combo) {
            let string = "ItemList=Combo.";
            let index = this.productURL.search(string) + string.length;
            let id = this.productURL.slice(index, index + 7);
            await p.evaluate((id) => {
                Biz.Product.Cart.addCombo(id, '', '1', '0');
            }, id);
        }

        await p.goto('https://secure.newegg.com/shop/cart')
    }
    async _checkout() {

    }
}
(async () => {
    if (config.verbose) console.log("Opening incognito chromium browser...");
    const browser = await puppeteer.launch(config.launch_settings);
    const context = await browser.createIncognitoBrowserContext();
    let signInBot = new NeweggSignInBot(context);
    await signInBot.run();
    let monitorBot = new NeweggMonitorBot(context, "https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4190483");
    // let monitorBot = new NeweggMonitorBot(context, "https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4206685");
    await monitorBot.run();
    // let test = new NeweggMonitorBot(browser, "https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4190483");
    // let test = new NeweggMonitorBot(browser, "https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4206685");
    // test.run();
})();