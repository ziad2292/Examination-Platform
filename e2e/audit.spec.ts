import { test, expect } from '@playwright/test';
for (const [role,path] of [['teacher','/teacher'],['student1','/student'],['admin','/admin']]) {
  test(`private ${path} workspace remains authorized and excluded from indexing`, async({page})=>{
    await page.goto('/login');
    await page.getByLabel('Email address').fill(`${role}@example.com`);
    await page.getByLabel('Password',{exact:true}).fill(role==='admin'?'AdminLocal123!':'LocalDemo123!');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow');
  });
}
test('malformed login return path cannot navigate off site',async({page})=>{
  await page.goto(`/login?next=${encodeURIComponent('/\\outside.example')}`);
  await page.getByLabel('Email address').fill('teacher@example.com');
  await page.getByLabel('Password',{exact:true}).fill('LocalDemo123!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL(/\/teacher$/);
});
test('registration status is excluded from indexing',async({page})=>{
  await page.goto('/registration-status');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow');
});
