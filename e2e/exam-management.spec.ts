import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async({page})=>{
  await page.goto("/login");
  await page.getByLabel("Email address",{exact:true}).fill("teacher@example.com");
  await page.getByLabel("Password",{exact:true}).fill("LocalDemo123!");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page).toHaveURL(/\/teacher/);
});

async function createDraft(page:Page,title:string){
  await page.goto("/teacher/exams/new");
  await page.getByLabel("Exam title",{exact:true}).fill(title);
  await page.getByRole("button",{name:"3. Schedule & create"}).click();
  await page.locator('input[name="scheduledStartAt"]').fill("2027-05-01T10:00");
  await page.locator('input[name="scheduledEndAt"]').fill("2027-05-01T12:00");
  await page.getByRole("button",{name:"Create and add sections"}).click();
  await expect(page).toHaveURL(/\/teacher\/exams\/[\da-f-]+$/);
}

test("dashboard delete accepts exact phrase and cancellation preserves draft",async({page})=>{
  const title=`QA delete draft ${Date.now()}`;
  await createDraft(page,title);
  await page.goto(`/teacher?q=${encodeURIComponent(title)}`);
  const card=page.getByRole("article").filter({has:page.getByRole("heading",{name:title,exact:true})});
  await card.getByText("More",{exact:true}).click();
  await card.getByRole("button",{name:"Delete draft",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Delete draft"});
  await dialog.getByRole("textbox").fill(title);
  await expect(dialog.getByRole("button",{name:"Delete draft",exact:true})).toBeDisabled();
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(card).toBeVisible();
  await card.getByRole("button",{name:"Delete draft",exact:true}).click();
  await dialog.getByRole("textbox").fill(`DELETE ${title}`);
  await dialog.getByRole("button",{name:"Delete draft",exact:true}).click();
  await expect(page).toHaveURL(/notice=deleted/);
  await page.goto(`/teacher?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("heading",{name:title,exact:true})).toHaveCount(0);
});

test("builder duplicate aligns icon and deletes the copy and source",async({page})=>{
  const title=`QA duplicate draft ${Date.now()}`;
  await createDraft(page,title);
  const source=page.url();
  await page.getByRole("button",{name:/Review & publish/}).click();
  const duplicate=page.getByRole("button",{name:"Duplicate",exact:true});
  const aligned=await duplicate.evaluate(button=>{const span=button.querySelector('span[aria-live]');return span?["flex","inline-flex"].includes(getComputedStyle(span).display)&&getComputedStyle(span).alignItems==="center":false;});
  expect(aligned).toBe(true);
  await duplicate.click();
  await expect(page).toHaveURL(/notice=duplicated/);
  await expect(page.getByRole("heading",{name:`${title} (Copy)`,exact:true})).toBeVisible();
  for(const name of [`${title} (Copy)`,title]){
    if(name===title)await page.goto(source);
    await page.getByRole("button",{name:/Review & publish/}).click();
    await page.getByRole("button",{name:"Permanently delete exam",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Permanently delete exam"});
    await dialog.getByRole("textbox").fill(`DELETE ${name}`);
    await dialog.getByRole("button",{name:"Permanently delete exam",exact:true}).click();
    await expect(page).toHaveURL(/notice=deleted/);
  }
});
