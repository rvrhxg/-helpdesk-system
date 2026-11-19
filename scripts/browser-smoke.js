// Isolated CI browser test for our own local app, independent of desktop UI automation.
import { chromium } from 'playwright';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { seedDemo } from '../src/demo.js';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=openDatabase(':memory:');
const password='ci-isolated-demo-password';seedDemo(db,password);
const server=createApp({db,origin:'http://127.0.0.1:3000'});
server.listen(3000,'127.0.0.1');await once(server,'listening');
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:3000');
  const login=async(email)=>{
    await page.getByLabel('Email',{exact:true}).fill(email);
    await page.getByLabel('Пароль',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Продолжить'}).click();
    await page.locator('#dashboard').waitFor({state:'visible'});
  };
  await login('client@example.test');
  await mkdir('screenshots',{recursive:true});
  await page.screenshot({path:'screenshots/dashboard-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Новое обращение'}).click();
  await page.getByLabel('Тема',{exact:true}).fill('Проверка браузерного сценария');
  await page.getByLabel('Описание',{exact:true}).fill('Создано через настоящую браузерную форму.');
  await page.getByRole('button',{name:'Отправить обращение'}).click();
  await page.getByRole('button',{name:'Проверка браузерного сценария',exact:true}).click();
  await page.getByLabel('Ваш комментарий').fill('Комментарий клиента');
  await page.getByRole('button',{name:'Отправить',exact:true}).click();
  await page.getByText('Комментарий клиента',{exact:true}).waitFor();
  await page.screenshot({path:'screenshots/ticket-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await login('agent@example.test');
  await page.getByText('Первый ответ · SLA',{exact:true}).waitFor();
  await page.screenshot({path:'screenshots/sla-analytics-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Проверка браузерного сценария',exact:true}).click();
  await page.getByLabel('Статус обращения').selectOption('resolved');
  await page.locator('#detail .muted').filter({hasText:'Решено'}).waitFor();
  await page.getByRole('button',{name:'Все обращения'}).click();
  await page.locator('#dashboard').waitFor({state:'visible'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'screenshots/dashboard-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Browser client create/comment, staff status and desktop/mobile captures passed.');
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();
}
