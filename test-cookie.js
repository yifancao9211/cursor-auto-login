import { tokenExchange } from './electron/services/token-exchange.js';

async function testRescue() {
    const cookie = process.argv[2];
    if (!cookie) {
        console.log("No cookie provided");
        return;
    }
    
    console.log("Testing with cookie:", cookie.substring(0, 20) + "...");
    
    const result = await tokenExchange.exchangeCookieToTokens(cookie);
    console.log("Result:", result);
}

testRescue();
