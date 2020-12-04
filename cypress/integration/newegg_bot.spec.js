describe('Newegg robot', () => {
    const itemURL = 'https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4190483';
    // const itemURL = 'https://www.newegg.com/Product/ComboDealDetails?ItemList=Combo.4206669&quicklink=true';
    // const itemURL = 'https://www.newegg.com/p/0BD-01YC-00006?Item=9SIAFP1BKW8244';
    let comboDeal = itemURL.search('ComboDeal') != -1;
    console.log(comboDeal);
    const email = Cypress.env('email');
    const password = Cypress.env('password');
    const csv = Cypress.env('csv');

    it('main', () => {
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
        cy.wait(3000);

        // visit item page
        cy.visit(itemURL);
        
        // recursively attempt to add to cart
        if (comboDeal) {
            function testStock () {
                cy.get('a.atnPrimary').then(($el) => {
                    const title = $el.attr('title');
                    if (title == 'Add Combo to Cart') {
                        cy.wrap($el).click();
                    } else {
                        cy.log("Out of stock, retrying...");
                        cy.reload(true).then(testStock);
                    }
                });
            }
            testStock();
        } else {
            function testStock() {
                cy.get('#ProductBuy div.nav-row:first').then(($el) => {
                    
                    if ($el.children.length == 2) {
                        cy.contains('Add to cart ').click();
                        cy.contains('No, thanks').click();
                        cy.contains('View Cart & Checkout').click();
                    } else {
                        cy.log("Out of stock, retrying...");
                        cy.reload(true).then(testStock);
                    }
                })
            }
            testStock();
        }

        // checkout
        cy.contains(' Secure Checkout ').click();
        cy.contains('Continue to delivery').click();
        cy.contains('Continue to payment').click();
        cy.get('div.retype-security-code input').type(csv);
        cy.contains('Review your order').click();
        cy.contains('Place Order').click();
        cy.wait(5000);

    });

});