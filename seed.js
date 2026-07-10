require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

const AUTHOR_ID = '6a3e60771d52cf602b58c8ed';

const products = [
  { title:'Void Slayer Vol. 1',    description:'An epic manga about a warrior who fights void creatures threatening the world.',          author:AUTHOR_ID, authorName:'Kenji Okafor',  contentType:'Manga',  genre:'Action',     tags:['action','fantasy'],    price:2000, ratingAvg:4.8, status:'live', publishedAt:new Date() },
  { title:'Crimson Throne',        description:'A manhwa about a queen who reclaims her stolen kingdom through cunning and power.',        author:AUTHOR_ID, authorName:'Seun Adeyemi', contentType:'Manhwa', genre:'Fantasy',    tags:['fantasy','romance'],   price:1800, ratingAvg:4.9, status:'live', publishedAt:new Date() },
  { title:'The Lagos Code',        description:'A tech thriller set in Lagos about a hacker who uncovers a government conspiracy.',       author:AUTHOR_ID, authorName:'Amara Nwosu',  contentType:'eBook',  genre:'Action',     tags:['thriller','tech'],     price:1500, ratingAvg:4.7, status:'live', publishedAt:new Date() },
  { title:'Iron Soul',             description:'A manga following a blacksmith who forges weapons with supernatural abilities.',          author:AUTHOR_ID, authorName:'Tunde Bello',  contentType:'Manga',  genre:'Fantasy',    tags:['fantasy','action'],    price:2500, ratingAvg:4.6, status:'live', publishedAt:new Date() },
  { title:'Beneath Abuja',         description:"A novel about ancient secrets buried beneath Nigeria's capital city.",                    author:AUTHOR_ID, authorName:'Chisom Eze',   contentType:'Novel',  genre:'Romance',    tags:['mystery','history'],   price:1200, ratingAvg:4.5, status:'live', publishedAt:new Date() },
  { title:'Tide Walker',           description:'A manhwa about a girl who can walk between ocean dimensions.',                           author:AUTHOR_ID, authorName:'Folake Aina',   contentType:'Manhwa', genre:'Action',     tags:['adventure','fantasy'], price:2200, ratingAvg:4.8, status:'live', publishedAt:new Date() },
  { title:'Dark Meridian',         description:'A manga set in a world where shadows are living creatures hunting humanity.',            author:AUTHOR_ID, authorName:'Emeka Obi',    contentType:'Manga',  genre:'Horror',     tags:['horror','action'],     price:3000, ratingAvg:4.9, status:'live', publishedAt:new Date() },
  { title:'Freelance in Nigeria',  description:'A practical eBook guide to building a freelance career in Nigeria.',                    author:AUTHOR_ID, authorName:'Ada Okonkwo',   contentType:'eBook',  genre:'Fantasy',    tags:['business','career'],   price:2000, ratingAvg:4.7, status:'live', publishedAt:new Date() },
];

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('✅ Connected');
  await Product.deleteMany({});
  await Product.insertMany(products);
  console.log('✅ Seeded', products.length, 'products with genres');
  process.exit(0);
}).catch(err => { console.error('❌', err.message); process.exit(1); });
