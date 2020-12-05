// const yargs = require('yargs');
// const argv = yargs
//     .option('url', {
//         year: {
//             description: 'Newegg product link',
//             alias: 'l',
//             type: 'string'
//         }
//     })
//     .help()
//     .alias('help', 'h')
//     .argv;

// assert(argv._.includes('url'));

// const itemURL = argv.url;

describe('Newegg bot', () => {
    const itemURL = 'https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4190483';
    // const itemURL = 'https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4206669';
    let comboDeal = itemURL.search('ComboDeal') != -1;
    console.log(comboDeal);
    const email = Cypress.env('email');
    const password = Cypress.env('password');
    const csv = Cypress.env('csv');

    before(() => {
        // prevent site exceptions from failing test
        cy.on('uncaught:exception', () => {
            return false;
        });

        // login
        cy.clearCookies();
        cy.visit('https://newegg.com');
        cy.get('a.nav-complex-inner').first().click();
        cy.get('[for=labeled-input-signEmail]').type(email);
        cy.get('#signInSubmit').click();
        cy.get('[for=labeled-input-password]').type(password);
        cy.get('#signInSubmit').click();
        
    });

    beforeEach(() => {
        Cypress.Cookies.preserveOnce("rmStore");
    });

    it('main', () => {
        // prevent site exceptions from failing test
        cy.on('uncaught:exception', () => {
            return false;
        });

        cy.wait(3000);
        // visit item page
        cy.visit(itemURL);

        // recursively check for stock
        function checkStock () {
            cy.request(itemURL).then((res) => {
                if (res.body.search(/add to cart/i) == -1) {
                    checkStock();
                }
            });
        }
        checkStock();

        // refresh page and add to cart
        cy.reload(true);
        cy.contains('Add to Cart').click();

        // checkout
        cy.contains('Secure Checkout').click();
        cy.contains('Continue to delivery').click();
        cy.contains('Continue to payment').click();
        cy.get('div.retype-security-code input').type(csv);
        cy.contains('Review your order').click();

        // DANGEROUS: comment out for testing
        cy.contains('Place Order').click();

        cy.wait(5000);

    });

}); 