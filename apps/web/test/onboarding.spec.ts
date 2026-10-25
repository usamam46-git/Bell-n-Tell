import { test, expect } from '@playwright/test';

test('owner can register, create a business, save contact, sign out and sign in', async ({ page }) => {
  const email = `browser-${crypto.randomUUID()}@example.test`;
  const password = 'correct horse battery stable 34';
  await page.goto('/');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill('Browser Owner');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page.getByText('Save your recovery code')).toBeVisible();
  await page.getByLabel('I saved this code in a safe place').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Business name').fill(`کائنات ${crypto.randomUUID().slice(0, 8)}`);
  await page.getByLabel('IANA timezone').fill('Asia/Karachi');
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page.getByText('Add services and hours')).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('hello@example.test');
  await page.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByRole('status').filter({hasText:'Contact details saved'})).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByText('Add services and hours')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('hello@example.test');
});

test('registration explains an unavailable API instead of showing a browser pattern error', async ({ page }) => {
  await page.route('**/api/v1/auth/register', (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email', { exact: true }).fill('unavailable@example.test');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery stable 34');
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page.getByRole('alert').filter({ hasText: 'The server is unavailable.' })).toHaveText('The server is unavailable. Please try again shortly.');
});
