import { chromium } from '@playwright/test';
import { writeFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
const label = process.argv[2] || 'before';
if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid label');
const base = 'http://localhost:3005';
const browser = await chromium.launch({executablePath: process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report = { timestamp: new Date().toISOString(), node: process.version, cpus: os.cpus().length, memoryBytes: os.totalmem(), routes: [], http: [], errors: [] };
const percentile = (samples, percent) => [...samples].sort((a,b)=>a-b)[Math.ceil(samples.length*percent)-1];
try {
  for (const role of [null, 'teacher', 'student1', 'admin']) {
    const context = await browser.newContext({viewport:{width:1366,height:900}});
    await context.addInitScript(() => {
      window.auditVitals = {lcp:0, cls:0};
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.auditVitals.lcp = e.startTime; }).observe({type:'largest-contentful-paint',buffered:true});
      new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.auditVitals.cls += e.value; }).observe({type:'layout-shift',buffered:true});
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({role,message:error.message}));
    if (role) {
      await page.goto(`${base}/login`);
      await page.getByLabel('Email address').fill(`${role}@example.com`);
      await page.getByLabel('Password',{exact:true}).fill(role==='admin'?'AdminLocal123!':'LocalDemo123!');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.waitForURL(/\/(teacher|student|admin)$/);
    }
    const routes = role==='admin'?['/admin','/admin/create','/admin/accounts','/admin/students']:role==='teacher'?['/teacher','/teacher/exams/30000000-0000-0000-0000-000000000001/monitor']:role?['/student','/student/profile']:['/','/login'];
    for (const route of routes) {
      await page.goto(base+route);
      await page.waitForTimeout(800);
      report.routes.push({role,route,...await page.evaluate(()=>{
        const n=performance.getEntriesByType('navigation')[0];
        const scripts=performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script');
        return {ttfbMs:n.responseStart-n.startTime,loadMs:n.loadEventEnd-n.startTime,...window.auditVitals,scriptBytes:scripts.reduce((a,r)=>a+r.encodedBodySize,0),scriptCount:scripts.length,overflow:document.documentElement.scrollWidth>innerWidth,robots:document.querySelector('meta[name="robots"]')?.content??null};
      })});
      const samples=[]; let errors=0;
      for(let i=0;i<20;i++) { const start=performance.now(); const response=await context.request.get(base+route); await response.body(); samples.push(performance.now()-start); if(response.status()!==200)errors++; }
      report.http.push({route,requests:20,errors,p50:percentile(samples,.5),p95:percentile(samples,.95),p99:percentile(samples,.99)});
    }
    await context.close();
  }
  async function bytes(path) { let sum=0; for(const item of await readdir(path,{withFileTypes:true})) { const p=`${path}/${item.name}`; sum+=item.isDirectory()?await bytes(p):(await stat(p)).size; } return sum; }
  report.staticBytes=await bytes('.next-audit/static');
  await writeFile(`docs/audits/production-readiness/evidence/${label}-browser.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
