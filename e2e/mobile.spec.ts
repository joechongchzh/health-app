import { expect, test } from '@playwright/test';

test('移动端可完成本地首次引导并进入主页', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '进入本地开发预览' }).click();
  await page.getByLabel('我已阅读并同意隐私说明').check();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('昵称').fill('测试用户');
  await page.getByLabel('生日').fill('1995-08-14');
  await page.getByLabel('身高（cm）').fill('175');
  await page.getByLabel('体重（kg）').fill('75');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '开始使用' }).click();
  await expect(page.getByText('你好，测试用户')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
});
