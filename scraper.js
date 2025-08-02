const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');

const getYad2Response = async (url) => {
    const requestOptions = {
        method: 'GET',
        redirect: 'follow'
    };
    try {
        const res = await fetch(url, requestOptions)
        return await res.text()
    } catch (err) {
        console.log(err)
    }
}

const scrapeItemsAndExtractImgUrls = async (url) => {
    const yad2Html = await getYad2Response(url);
    if (!yad2Html) {
        throw new Error("Could not get Yad2 response");
    }
    // const fs = require('fs');
    // const yad2Html = fs.readFileSync('testhtml.html', 'utf-8');
    const $ = cheerio.load(yad2Html);
    const title = $("title")
    const titleText = title.first().text();
    if (titleText === "ShieldSquare Captcha") {
        throw new Error("Bot detection");
    }
    const $feedItems = $('[class^="feed-item-base_feedItemBox"]');
    if (!$feedItems) {
        throw new Error("Could not find feed items");
    }
    console.log($feedItems.length, "items found");

    const imageUrls = []
    $feedItems.each((_, elm) => {
        const imgSrc = $(elm).find("img").attr('src');
        const itemLink = $(elm).find("a").attr('href');
        const marketingText = $(elm).find('[class^="feed-item-info_marketingText"]').text();
        const yearAndHand = $(elm).find('[class^="feed-item-info_yearAndHandBox"]').text();
        const price = $(elm).find('[class^="price_price"]').text();
        if (imgSrc) {
            const tuple = [imgSrc, "https://www.yad2.co.il/vehicles/" + itemLink, marketingText, yearAndHand, price];
            imageUrls.push(tuple)
            console.log(tuple);
        }
    })
    return imageUrls;
}

const checkIfHasNewItem = async (imgUrls, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedUrls = [];
    try {
        savedUrls = require(filePath);
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND") {
            fs.mkdirSync('data');
            fs.writeFileSync(filePath, '[]');
        } else {
            console.log(e);
            throw new Error(`Could not read / create ${filePath}`);
        }
    }
    let shouldUpdateFile = false;
    savedUrls = savedUrls.filter(savedUrl => {
        shouldUpdateFile = true;
        return imgUrls.map(a => a[0]).includes(savedUrl);
    });
    const newItems = [];
    imgUrls.forEach(url => {
        if (!savedUrls.includes(url[0])) {
            savedUrls.push(url[0]);
            newItems.push(url);
            shouldUpdateFile = true;
        }
    });
    if (shouldUpdateFile) {
        const updatedUrls = JSON.stringify(savedUrls, null, 2);
        fs.writeFileSync(filePath, updatedUrls);
        await createPushFlagForWorkflow();
    }
    return newItems;
}

const createPushFlagForWorkflow = () => {
    fs.writeFileSync("push_me", "")
}

const sendText = (telenode, msg) => {
    console.log(`Sending message: ${msg}`);
    const chatId = process.env.CHAT_ID || config.chatId;
    telenode.sendTextMessage(msg, chatId);
}

const scrape = async (topic, url) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const telenode = new Telenode({apiToken})
    try {        
        const scrapeImgResults = await scrapeItemsAndExtractImgUrls(url);
        const newItems = await checkIfHasNewItem(scrapeImgResults, topic);
        if (newItems.length > 0) {
            for (const item of newItems) {
                const imgUrl = item[0];
                const itemLink = item[1];
                const marketingText = item[2];
                const yearAndHand = item[3];
                const price = item[4];
                const message = `Hi there! I found a new item for you on Yad2:\n\n
                ${marketingText}\n
                ${yearAndHand}\n
                ${price}\n
                Image Link: ${imgUrl}\n\n
                Item Link: ${itemLink}`;
                await sendText(telenode, message);
            }
        }
    } catch (e) {
        let errMsg = e?.message || "";
        if (errMsg) {
            errMsg = `Error: ${errMsg}`
        }
        await sendText(telenode, `Scan workflow failed... 😥\n${errMsg}`)
        throw new Error(e)
    }
}

const program = async () => {
    await Promise.all(config.projects.filter(project => {
        if (project.disabled) {
            console.log(`Topic "${project.topic}" is disabled. Skipping.`);
        }
        return !project.disabled;
    }).map(async project => {
        await scrape(project.topic, project.url)
    }))
};

program();
