const undici = require('undici');
const puppeteer = require('puppeteer-extra');
const config = require('./config/puppeteer.json');

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())
const pluginStealth = require('puppeteer-extra-plugin-stealth')()
console.log(pluginStealth.availableEvasions)

// add recaptcha solver
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha')
puppeteer.use(
    RecaptchaPlugin({
      provider: { id: '2captcha', token: config.vars.two_captcha_token },
      visualFeedback: true // colorize reCAPTCHAs (violet = detected, green = solved)
    })
  )

class NeweggBot {
    constructor({productURL, verbose = false}) {
        this.productURL = productURL;
        config.verbose = verbose;
    }
    async run(browser) {
        await this._initPuppeteer(browser);
        await this._signIn();
        await this._monitorProduct();
        await this._addProductToCart();
        await this._checkout()
    }
    async _initPuppeteer(browser) {
        if (config.verbose) console.log("Initializing Puppeteer...");
        if (config.verbose) console.log("Opening incognito context...");
        this.context = await browser.createIncognitoBrowserContext();
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
        if (config.verbose) console.log(`Going to ${config.base_url}...`);
        await p.goto(config.base_url);

        async function solveCaptchas() {
            // ...todo: check for captcha page and solve captchas
        }

        // sign in
        if (config.verbose) console.log("Signing in...");
        // go to sign in URL (changes, so must be retrieved each time)
        await p.waitForSelector(s.link);
        const signInURL = await p.$eval(s.link, el => el.getAttribute("href"));
        await p.goto(signInURL);

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
        await checkButton();
        await p.click(s.continue);
        try {
            await p.waitForSelector(s.passwd, {timeout: 35000});
        } catch (e) {
            console.log("Password not found, maybe you have to input a code?");
        }
        await p.type(s.passwd, v.passwd), {delay: 5};
        await checkButton();
        await p.click(s.continue);
        await p.waitForNavigation();
    }
    async _monitorProduct() {
        // define abbreviated variables for code readability
        // (these will be reserved variables for this class)
        const p = this.page;

        if (config.verbose) console.log(`Going to ${this.productURL}`);
        // await p.goto(this.productURL);
        
        if (config.verbose) console.log("Monitoring status...");
        const client = new undici.Client(config.base_url);
        async function _checkStatus(url) {
            return new Promise(function(resolve, reject) {
                client.request({
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
                        if (res.search(/add to cart/i) != -1) {
                            resolve(true);
                        }
                        resolve(false);
                    })
                });
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

        // force page to update
        if (config.verbose) console.log("Force refreshing page...");
        await p.setCacheEnabled(false);
        await p.reload();

        // 
    }
    async _checkout() {

    }
}
(async () => {
    let browser = await puppeteer.launch(config.launch_settings);
    let bot = new NeweggBot({
        productURL: "https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4206669",
        verbose: true
    });
    bot.run(browser);
})();