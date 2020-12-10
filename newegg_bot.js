const undici = require('undici');
const puppeteer = require('puppeteer-extra');
const config = require('./config.json');
const selectors = require('./selectors')

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// add recaptcha solver
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
if (config.vars.two_captcha_token) {
    puppeteer.use(
        RecaptchaPlugin({
          provider: { id: '2captcha', token: config.vars.two_captcha_token },
          visualFeedback: true // colorize reCAPTCHAs (violet = detected, green = solved)
        })
    );
}


// shim Promise.any if unsupported
var any = require('promise.any');
any.shim();


// simple async delay function 
function delay(time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time);
    });
}

// simple random between min and max functino
function random(min, max) {
    return Math.random() * (max - min) + min;
}

// random async delay function
async function delayRandom(timeMin, timeMax) {
    await delay(random(timeMin, timeMax));
}

// random delay between typing chars
async function typeRandom(element, string, min, max) {
    let charArray = string.split('');
    for (let i = 0; i < charArray.length; i++) {
        await delayRandom(min, max);
        await element.type(charArray[i]), random(min, max);
    }
}

// logging function
async function report (log, newline = true) {
    currentTime = new Date();
    output = currentTime.toString().split('G')[0] + ': ' + log;
    if (newline) {
        output += '\n';
    }
	process.stdout.write(output);
}

// define constants
const baseURL = "https://www.newegg.com/";

class NeweggBot {
    constructor(browser, id) {
        this.id = id;
        this.browser = browser;
    }
    async _init() {
        if (config.verbose) report(`${this.id} - Opening new page...`);
        this.page = await this.browser.newPage();
        this.page.setDefaultTimeout(0);
        // disable cache
        await this.page.setCacheEnabled(false);

    }
    async _solveCaptcha() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const p = this.page;
        
        if (config.vars.two_captcha_token) {
            if (p.url().includes("areyouahuman")) {
                if (config.verbose) report(`${this.id} - Captcha detected, solving...`);
                await p.solveRecaptchas();
                await delay(2000);
                await Promise.all([
                    p.waitForNavigation(),
                    p.solveRecaptchas()
                ]);
            }
        } else {
            await p.waitForNavigation();
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
        const s = selectors.sign_in;
        const v = config.vars;
        const p = this.page;

        // go to newegg.com
        if (config.verbose) report(`${this.id} - Going to ${baseURL}...`);
        report(p)
        await p.goto(baseURL);
        
        // check for/solve captcha
        await this._solveCaptcha();

        // sign in
        if (config.verbose) report(`${this.id} - Signing in...`);
        // go to sign in URL (changes, so must be retrieved each time)
        await p.waitForSelector(s.link);
        const signInURL = await p.$eval(s.link, el => el.getAttribute("href"));
        await p.goto(signInURL);
        
        // check for/solve captcha
        await this._solveCaptcha();
        
        // sign in with email and password
        await p.waitForSelector(s.email);
        await typeRandom(await p.$(s.email), v.email, 40, 64);
        await delayRandom(500, 1000);
        await p.click(s.continue);
        await delayRandom(500, 1000);
        try {
            await p.waitForSelector(s.passwd, {timeout: 10000});
            await typeRandom(await p.$(s.passwd), v.passwd, 23, 100);
        } catch (e) {
            report(`${this.id} - Password not found, maybe you have to input a code?`);
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
    constructor(browser, id, productURL) {
        super(browser, id);
        this.productURL = productURL;
        this.combo = productURL.includes('ComboDeal');
        if (this.combo) {
            this.itemNumber = productURL.slice(productURL.length - 13, productURL.length);
        } else {
            this.itemNumber = productURL.slice(productURL.length - 15, productURL.length);
        }
        if (config.verbose) report(`${this.id} - Product ${this.itemNumber}`);
    }
    async run() {
        await this._init();
        await this._monitorProduct();
        await this._checkout()
    }
    async _monitorProduct() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const p = this.page;
        const s = selectors.monitor;

        if (config.verbose) report(`${this.id} - Going to ${this.productURL}`);
        await p.goto(this.productURL);
        
        // check for/solve captcha
        await this._solveCaptcha();
        
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
                    
                    if (statusCode !== 200) reject(`${statusCode} returned`);
                    
                    let res = '';
                    body.setEncoding('utf8');
                    body.on('data', d => {
                        res += d;
                    });
                    body.on('end', () => {
                        if (res.search(/add to cart/i) != -1) {
                            resolve(true);
                        }
                        resolve(false);
                    })
                })}, random(config.delay_range.min, config.delay_range.max));
            });   
        }

        async function _checkStatusReload() {
            await delay(config.delay_range.min, config.delay_range.max);
            await p.reload();
            try {
                await page.goto('https://secure.newegg.com/Shopping/AddtoCart.aspx?Submit=ADD&ItemList=' + self.itemNumber, { waitUntil: 'load' });
                await self._solveCaptcha();
                if (page.url().includes("ShoppingCart")) {
                    return true;
                } else if (page.url().includes("ShoppingItem")) {
                    await page.goto('https://secure.newegg.com/Shopping/ShoppingCart.aspx');
                    return true;
                }
            } catch (err) { /* pass */ }
            return false;
        }
        let count = 0;
        try {
            if (config.verbose) report(`${this.id} - Monitoring status...`);
            while (!(await _checkStatusRequest(this.productURL))){
                count++;
                if (config.verbose) report(`${this.id} - Item out of stock, attempt ${count}...\r`);
            }
            if (this.combo) {
                if (config.verbose) report(`${this.id} - Adding item to cart...`);
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
                throw 'Non-combo item';
            }
        } catch (err){
            if (err == '302 returned') {
                if (config.verbose) report(`${this.id} - They're onto us! Try using a VPN. Switching to alternate (slower) stock polling system...`);
                await this._solveCaptcha();
            }
            while (!(await _checkStatusReload())) {
                count++;
                if (config.verbose) report(`${this.id} - Item out of stock, attempt ${count}...\r`);
            }
        }
        client.close();
    }
    async _checkout() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const s = selectors.checkout;
        const v = config.vars;
        const p = this.page;

        if (config.verbose) report(`${self.id} - Checking out...`);
        await p.waitForXPath(s.checkout);
        const checkout = await p.$x(s.checkout);
        await checkout[0].click();
        if (config.verbose) report(`${self.id} - Delivery...`);
        await p.waitForXPath(s.delivery);
        const delivery = await p.$x(s.delivery);
        await delivery[0].click();
        if (config.verbose) report(`${self.id} - Payment...`);
        await p.waitForXPath(s.payment);
        const payment = await p.$x(s.payment);
        await payment[0].click();
        await p.waitForSelector(s.cvv);
        await p.type(s.cvv, v.cvv);
        if (config.verbose) report(`${self.id} - Reviewing order...`);
        await p.waitForXPath(s.review);
        const review = await p.$x(s.review);
        await review[0].click();

        // BE VERY CAREFUL WHEN TESTING, DO NOT UNCOMMENT THE FOLLOWING LINES
        if (config.verbose) report(`${self.id} - Placing order...`);
        await p.waitForXPath(s.place);
        const place = await p.$x(s.place);
        await place[0].click();
    }
}
(async () => {
    if (config.verbose) report("Opening chromium browser...");
    const browser = await puppeteer.launch(config.launch_settings);
    // const context = await browser.createIncognitoBrowserContext();
    let signInBot = new NeweggSignInBot(browser, "Sign in bot");
    await signInBot.run();

    let monitorBots = [];
    for (let i = 0; i < config.products.length; i++) {
        monitorBots.push(new NeweggMonitorBot(browser, `Bot ${i}`, config.products[i]).run());
    }
    await Promise.any(monitorBots);
})();