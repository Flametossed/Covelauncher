import axios from 'axios';
import * as cheerio from 'cheerio';

const res = await axios.get('https://nswpedia.com/nintendo-switch-roms?orderby=popular');
const $ = cheerio.load(res.data);
const count = $('#dle-content .soft-item').length;
console.log('count:', count);
const titles = [];
$('#dle-content .soft-item').each((_, el) => {
  if (titles.length < 5) titles.push($(el).find('.soft-item-title').text().trim());
});
console.log('titles:', titles);
