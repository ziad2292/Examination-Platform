import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.E2E_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const results=[];
try {
  for(const role of [null,'teacher','student1','admin']) {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    if(role){
      await page.goto('http://localhost:3005/login');
      await page.getByLabel('Email address').fill(`${role}@example.com`);
      await page.getByLabel('Password',{exact:true}).fill(role==='admin'?'AdminLocal123!':'LocalDemo123!');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.waitForURL(/\/(admin|teacher|student)$/);
    }
    for(const path of role==='admin'?['/admin/accounts','/admin/students','/admin/create']:role==='teacher'?['/teacher','/teacher/exams/new']:role?['/student','/student/profile']:['/','/login','/register']) {
      await page.goto(`http://localhost:3005${path}`);
      // App Router may finish the document load while a streamed fallback is visible.
      await page.locator('h1').first().waitFor({state:'visible'});
      const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      results.push({path,viewport:'390x844',violations:scan.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,helpUrl:v.helpUrl,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:scan.incomplete.map(v=>v.id)});
    }
    await context.close();
  }
  await writeFile('docs/audits/production-readiness/evidence/accessibility.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.map(r=>({path:r.path,violations:r.violations.map(v=>({id:v.id,nodes:v.nodes.length}))})),null,2));
}finally{await browser.close();}
