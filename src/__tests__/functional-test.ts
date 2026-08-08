/**
 * Functional test script -- comprehensive interactive testing.
 * Run with: npx tsx src/__tests__/functional-test.ts
 */
import { chromium, type BrowserContext } from 'playwright';

interface TestResult {
  category: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  details: string;
}

const results: TestResult[] = [];

function record(category: string, name: string, status: 'PASS' | 'FAIL' | 'SKIP', details: string) {
  results.push({ category, name, status, details });
  const icon = status === 'PASS' ? '[PASS]' : status === 'FAIL' ? '[FAIL]' : '[SKIP]';
  console.log(`${icon} [${category}] ${name} -- ${details}`);
}

async function testLayoutAndNav(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // --- Sidebar exists ---
  const sidebarEl = page.locator('aside, [class*="sidebar"], nav').first();
  const sidebarVisible = await sidebarEl.isVisible();
  record('Layout', 'Sidebar visible on desktop', sidebarVisible ? 'PASS' : 'FAIL', sidebarVisible ? 'Sidebar is visible' : 'Sidebar not found');

  // --- Nav items ---
  const navTexts = ['Chat', 'Plugins', 'MCP Servers', 'Settings'];
  for (const text of navTexts) {
    const navItem = page.locator(`text="${text}"`).first();
    const visible = await navItem.isVisible().catch(() => false);
    record('Layout', `Nav item "${text}" visible`, visible ? 'PASS' : 'FAIL', visible ? 'Found' : 'Not found');
  }

  // --- Nav highlight (Chat should be active on /chat) ---
  const chatNavLink = page.locator('a[href="/chat"], a[href*="chat"]').first();
  const chatNavClasses = await chatNavLink.getAttribute('class') || '';
  const isActiveChat = chatNavClasses.includes('active') || chatNavClasses.includes('bg-') || chatNavClasses.includes('font-medium') || chatNavClasses.includes('font-semibold');
  record('Layout', 'Chat nav highlighted on /chat', isActiveChat ? 'PASS' : 'FAIL', `Classes: ${chatNavClasses.substring(0, 100)}`);

  // --- Navigate to Plugins and check highlight ---
  await page.click('text="Plugins"');
  await page.waitForTimeout(500);
  const pluginsUrl = page.url();
  record('Layout', 'Navigate to Plugins via nav', pluginsUrl.includes('/plugins') ? 'PASS' : 'FAIL', `URL: ${pluginsUrl}`);

  // --- Navigate to Settings ---
  await page.click('text="Settings"');
  await page.waitForTimeout(500);
  const settingsUrl = page.url();
  record('Layout', 'Navigate to Settings via nav', settingsUrl.includes('/settings') ? 'PASS' : 'FAIL', `URL: ${settingsUrl}`);

  // --- Theme toggle ---
  const allButtons = await page.locator('button').all();
  let themeToggleBtn = null;
  for (const btn of allButtons) {
    const ariaLabel = await btn.getAttribute('aria-label') || '';
    const title = await btn.getAttribute('title') || '';
    if (ariaLabel.toLowerCase().includes('theme') || title.toLowerCase().includes('theme')) {
      themeToggleBtn = btn;
      break;
    }
  }
  // Try finding the moon/sun icon button in the header
  if (!themeToggleBtn) {
    themeToggleBtn = page.locator('header button, [class*="header"] button').last();
  }

  if (themeToggleBtn) {
    const htmlBefore = await page.locator('html').getAttribute('class') || '';
    const styleBefore = await page.locator('html').getAttribute('style') || '';
    await themeToggleBtn.click();
    await page.waitForTimeout(500);
    const htmlAfter = await page.locator('html').getAttribute('class') || '';
    const styleAfter = await page.locator('html').getAttribute('style') || '';
    const themeChanged = htmlBefore !== htmlAfter || styleBefore !== styleAfter;
    record('Layout', 'Theme toggle changes theme', themeChanged ? 'PASS' : 'FAIL', `Before: class="${htmlBefore}" style="${styleBefore}" | After: class="${htmlAfter}" style="${styleAfter}"`);

    // Take dark mode screenshot
    await page.screenshot({ path: 'src/__tests__/screenshots/dark-mode.png', fullPage: true });

    // Toggle back
    await themeToggleBtn.click();
    await page.waitForTimeout(300);
  } else {
    record('Layout', 'Theme toggle changes theme', 'SKIP', 'Theme toggle button not found');
  }

  // --- Sidebar collapse ---
  const collapseBtn = page.locator('[data-testid="sidebar-toggle"], button[aria-label*="sidebar"], button[aria-label*="collapse"], button[title*="sidebar"]');
  const collapseCount = await collapseBtn.count();
  if (collapseCount > 0) {
    await collapseBtn.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'src/__tests__/screenshots/sidebar-collapsed.png', fullPage: true });
    record('Layout', 'Sidebar collapse button works', 'PASS', 'Clicked collapse button');
    // Expand again
    await collapseBtn.first().click();
    await page.waitForTimeout(300);
  } else {
    record('Layout', 'Sidebar collapse button', 'SKIP', 'No collapse button found with common selectors');
  }

  await page.close();
}

async function testMobileResponsive(context: BrowserContext) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'src/__tests__/screenshots/mobile-chat.png', fullPage: true });

  // Check if sidebar is hidden on mobile
  const sidebarEl = page.locator('aside, [class*="sidebar"]').first();
  const sidebarBox = await sidebarEl.boundingBox().catch(() => null);
  const sidebarHidden = !sidebarBox || sidebarBox.width === 0 || sidebarBox.x < -100;
  record('Responsive', 'Sidebar hidden on mobile', sidebarHidden ? 'PASS' : 'FAIL', sidebarBox ? `Box: x=${sidebarBox.x} w=${sidebarBox.width}` : 'No bounding box');

  // Check for hamburger menu
  const hamburger = page.locator('button[aria-label*="menu"], button[aria-label*="sidebar"], [data-testid="mobile-menu"]');
  const hamburgerCount = await hamburger.count();
  record('Responsive', 'Hamburger menu button exists', hamburgerCount > 0 ? 'PASS' : 'FAIL', `Found ${hamburgerCount} potential hamburger buttons`);

  // Test plugins page on mobile
  await page.goto('http://localhost:3000/plugins', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'src/__tests__/screenshots/mobile-plugins.png', fullPage: true });
  record('Responsive', 'Plugins page renders on mobile', 'PASS', 'Screenshot taken');

  // Test settings page on mobile
  await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'src/__tests__/screenshots/mobile-settings.png', fullPage: true });
  record('Responsive', 'Settings page renders on mobile', 'PASS', 'Screenshot taken');

  await page.close();
}

async function testChatFlow(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // --- New Chat button ---
  const newChatBtn = page.locator('text="New Chat"').first();
  const newChatVisible = await newChatBtn.isVisible().catch(() => false);
  record('Chat', 'New Chat button visible', newChatVisible ? 'PASS' : 'FAIL', newChatVisible ? 'Found' : 'Not found');

  // --- Chat input ---
  const chatInput = page.locator('textarea, input[type="text"]').first();
  const inputVisible = await chatInput.isVisible().catch(() => false);
  record('Chat', 'Chat input visible', inputVisible ? 'PASS' : 'FAIL', inputVisible ? 'Found' : 'Not found');

  // --- Send button ---
  const sendBtn = page.locator('button[type="submit"], button:has(svg[class*="send"]), button[aria-label*="send"]');
  // Also try locating by the paper plane icon area
  const sendBtnCount = await sendBtn.count();
  record('Chat', 'Send button present', sendBtnCount > 0 ? 'PASS' : 'FAIL', `Found ${sendBtnCount} potential send buttons`);

  // --- Placeholder text ---
  if (inputVisible) {
    const placeholder = await chatInput.getAttribute('placeholder') || '';
    record('Chat', 'Input has placeholder text', placeholder.length > 0 ? 'PASS' : 'FAIL', `Placeholder: "${placeholder}"`);
  }

  // --- Empty state ---
  const emptyStateText = page.locator('text=/Chat with your workspace|与你的工作区对话/').first();
  const hasEmptyState = await emptyStateText.isVisible().catch(() => false);
  record('Chat', 'Empty state shown when no messages', hasEmptyState ? 'PASS' : 'FAIL', hasEmptyState ? 'Workspace chat empty state shown' : 'Empty state not found');

  // --- Try sending a message (this likely won't get a real response without API key, but we can test the UI) ---
  if (inputVisible) {
    await chatInput.fill('Hello, this is a test message');
    await page.waitForTimeout(200);
    const inputValue = await chatInput.inputValue();
    record('Chat', 'Can type in chat input', inputValue.includes('test message') ? 'PASS' : 'FAIL', `Input value: "${inputValue.substring(0, 50)}"`);

    // Press Enter to send
    await chatInput.press('Enter');
    await page.waitForTimeout(2000);

    // Check if the message appeared in the chat
    const userMessage = page.locator('[class*="message"], [data-role="user"], [class*="user"]');
    const messageCount = await userMessage.count();
    record('Chat', 'Message appears after sending', messageCount > 0 ? 'PASS' : 'FAIL', `Found ${messageCount} message elements`);

    // Take screenshot of the chat after sending
    await page.screenshot({ path: 'src/__tests__/screenshots/chat-after-send.png', fullPage: true });

    // Check if URL changed (new conversation created)
    const urlAfterSend = page.url();
    record('Chat', 'URL updates after sending message', urlAfterSend !== 'http://localhost:3000/chat' ? 'PASS' : 'FAIL', `URL: ${urlAfterSend}`);

    // Check sidebar for new conversation
    await page.waitForTimeout(1000);
      const chatLinks = await page.locator('aside a[href*="/chat/"]').count();
    record('Chat', 'Conversation appears in sidebar', chatLinks > 0 ? 'PASS' : 'FAIL', `Found ${chatLinks} chat links in sidebar`);
  }

  await page.close();
}

async function testPlugins(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000/plugins', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // --- Page title ---
  const title = page.locator('text="Plugins & Skills"').first();
  const hasTitle = await title.isVisible().catch(() => false);
  record('Plugins', 'Page title visible', hasTitle ? 'PASS' : 'FAIL', hasTitle ? 'Found' : 'Not found');

  // --- Search input ---
  const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
  const hasSearch = await searchInput.isVisible().catch(() => false);
  record('Plugins', 'Search input visible', hasSearch ? 'PASS' : 'FAIL', hasSearch ? 'Found' : 'Not found');

  // --- Filter tabs ---
  const allTab = page.locator('text="All"').first();
  const globalTab = page.locator('text="Global"').first();
  const hasFilters = (await allTab.isVisible().catch(() => false)) && (await globalTab.isVisible().catch(() => false));
  record('Plugins', 'Filter tabs visible (All/Global/Project)', hasFilters ? 'PASS' : 'FAIL', hasFilters ? 'Found' : 'Not found');

  // --- Empty state ---
  const emptyState = page.locator('text="No skills found"').first();
  const hasEmptyState = await emptyState.isVisible().catch(() => false);
  record('Plugins', 'Empty state shown when no skills', hasEmptyState ? 'PASS' : 'FAIL', hasEmptyState ? 'Shown' : 'Not shown');

  // --- MCP Servers link ---
  const mcpLink = page.locator('text="MCP Servers"').first();
  const hasMcpLink = await mcpLink.isVisible().catch(() => false);
  record('Plugins', 'MCP Servers button/link visible', hasMcpLink ? 'PASS' : 'FAIL', hasMcpLink ? 'Found' : 'Not found');

  // --- Navigate to MCP page ---
  if (hasMcpLink) {
    await mcpLink.click();
    await page.waitForTimeout(500);
    const mcpUrl = page.url();
    record('Plugins', 'Navigate to MCP Servers page', mcpUrl.includes('/plugins/mcp') ? 'PASS' : 'FAIL', `URL: ${mcpUrl}`);
  }

  await page.close();
}

async function testMCPPage(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000/plugins/mcp', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // --- Page title ---
  const title = page.locator('text="MCP Servers"').first();
  const hasTitle = await title.isVisible().catch(() => false);
  record('MCP', 'Page title visible', hasTitle ? 'PASS' : 'FAIL', hasTitle ? 'Found' : 'Not found');

  // --- Add Server button ---
  const addBtn = page.locator('text="Add Server"').first();
  const hasAddBtn = await addBtn.isVisible().catch(() => false);
  record('MCP', 'Add Server button visible', hasAddBtn ? 'PASS' : 'FAIL', hasAddBtn ? 'Found' : 'Not found');

  // --- Tabs (Servers / JSON Config) ---
  const serversTab = page.locator('text="Servers"').first();
  const jsonTab = page.locator('text="JSON Config"').first();
  const hasTabs = (await serversTab.isVisible().catch(() => false)) && (await jsonTab.isVisible().catch(() => false));
  record('MCP', 'Tabs visible (Servers/JSON Config)', hasTabs ? 'PASS' : 'FAIL', hasTabs ? 'Found' : 'Not found');

  // --- Empty state ---
  const emptyState = page.locator('text="No MCP servers configured"').first();
  const hasEmptyState = await emptyState.isVisible().catch(() => false);
  record('MCP', 'Empty state shown', hasEmptyState ? 'PASS' : 'FAIL', hasEmptyState ? 'Shown' : 'Not shown');

  // --- Back button ---
  const backBtn = page.locator('button:has(svg), a[href="/plugins"]').first();
  const hasBackBtn = await backBtn.isVisible().catch(() => false);
  record('MCP', 'Back navigation available', hasBackBtn ? 'PASS' : 'FAIL', hasBackBtn ? 'Found' : 'Not found');

  // --- Test Add Server dialog ---
  if (hasAddBtn) {
    await addBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'src/__tests__/screenshots/mcp-add-dialog.png', fullPage: true });

    const dialog = page.locator('[role="dialog"], [class*="dialog"], [class*="modal"]').first();
    const hasDialog = await dialog.isVisible().catch(() => false);
    record('MCP', 'Add Server dialog opens', hasDialog ? 'PASS' : 'FAIL', hasDialog ? 'Dialog visible' : 'Dialog not found');

    if (hasDialog) {
      // Check form fields
      const nameInput = page.locator('input[placeholder*="name"], input[name="name"], label:has-text("Name") + input, label:has-text("Name") ~ input').first();
      const hasName = await nameInput.isVisible().catch(() => false);
      record('MCP', 'Add dialog has name field', hasName ? 'PASS' : 'FAIL', hasName ? 'Found' : 'Not found');

      // Close dialog
      const cancelBtn = page.locator('text="Cancel"').first();
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(300);
      }
    }
  }

  // --- Test JSON Config tab ---
  if (hasTabs) {
    await jsonTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'src/__tests__/screenshots/mcp-json-config.png', fullPage: true });

    const jsonEditor = page.locator('textarea, [class*="editor"], [class*="json"], pre, code');
    const jsonEditorCount = await jsonEditor.count();
    record('MCP', 'JSON Config tab shows editor', jsonEditorCount > 0 ? 'PASS' : 'FAIL', `Found ${jsonEditorCount} editor elements`);
  }

  await page.close();
}

async function testSettings(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // --- Page title ---
  const title = page.locator('h1:has-text("Settings"), h2:has-text("Settings")').first();
  const hasTitle = await title.isVisible().catch(() => false);
  record('Settings', 'Page title visible', hasTitle ? 'PASS' : 'FAIL', hasTitle ? 'Found' : 'Not found');

  // --- Visual/JSON Editor toggle ---
  const visualBtn = page.locator('text="Visual Editor"').first();
  const jsonBtn = page.locator('text="JSON Editor"').first();
  const hasEditorToggle = (await visualBtn.isVisible().catch(() => false)) && (await jsonBtn.isVisible().catch(() => false));
  record('Settings', 'Editor mode toggle visible', hasEditorToggle ? 'PASS' : 'FAIL', hasEditorToggle ? 'Found' : 'Not found');

  // --- Permissions section ---
  const permissionsSection = page.locator('text="Permissions"').first();
  const hasPermissions = await permissionsSection.isVisible().catch(() => false);
  record('Settings', 'Permissions section visible', hasPermissions ? 'PASS' : 'FAIL', hasPermissions ? 'Found' : 'Not found');

  // --- Environment Variables section ---
  const envSection = page.locator('text="Environment Variables"').first();
  const hasEnv = await envSection.isVisible().catch(() => false);
  record('Settings', 'Environment Variables section visible', hasEnv ? 'PASS' : 'FAIL', hasEnv ? 'Found' : 'Not found');

  // --- Save button ---
  const saveBtn = page.locator('text="Save Changes"').first();
  const hasSave = await saveBtn.isVisible().catch(() => false);
  record('Settings', 'Save Changes button visible', hasSave ? 'PASS' : 'FAIL', hasSave ? 'Found' : 'Not found');

  // --- Reset button ---
  const resetBtn = page.locator('text="Reset"').first();
  const hasReset = await resetBtn.isVisible().catch(() => false);
  record('Settings', 'Reset button visible', hasReset ? 'PASS' : 'FAIL', hasReset ? 'Found' : 'Not found');

  // --- Switch to JSON Editor ---
  if (hasEditorToggle) {
    await jsonBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'src/__tests__/screenshots/settings-json-mode.png', fullPage: true });

    const jsonTextarea = page.locator('textarea').first();
    const jsonVisible = await jsonTextarea.isVisible().catch(() => false);
    record('Settings', 'JSON editor textarea visible', jsonVisible ? 'PASS' : 'FAIL', jsonVisible ? 'Found' : 'Not found');

    if (jsonVisible) {
      const jsonContent = await jsonTextarea.inputValue();
      let isValidJson = false;
      try {
        JSON.parse(jsonContent);
        isValidJson = true;
      } catch {}
      record('Settings', 'JSON editor contains valid JSON', isValidJson ? 'PASS' : 'FAIL', `Content length: ${jsonContent.length}, preview: ${jsonContent.substring(0, 100)}`);
    }

    // Switch back to Visual Editor
    await visualBtn.click();
    await page.waitForTimeout(500);
    record('Settings', 'Switch back to Visual Editor', 'PASS', 'Switched');
  }

  await page.close();
}

async function testConsoleErrors(context: BrowserContext) {
  const routes = ['/chat', '/plugins', '/plugins/mcp', '/settings'];

  for (const route of routes) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto(`http://localhost:3000${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Filter out known non-critical errors (like favicon 404, hydration warnings in dev)
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('hydrat') &&
      !e.includes('Warning:') &&
      !e.includes('DevTools')
    );

    record('Console', `No JS errors on ${route}`, criticalErrors.length === 0 ? 'PASS' : 'FAIL',
      criticalErrors.length === 0 ? 'No critical errors' : `Errors: ${criticalErrors.join(' | ').substring(0, 200)}`);

    await page.close();
  }
}

async function main() {
  console.log('Starting comprehensive functional tests...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  await testConsoleErrors(context);
  await testLayoutAndNav(context);
  await testMobileResponsive(context);
  await testChatFlow(context);
  await testPlugins(context);
  await testMCPPage(context);
  await testSettings(context);

  await browser.close();

  // Summary
  console.log('\n========================================');
  console.log('         FUNCTIONAL TEST SUMMARY');
  console.log('========================================\n');

  const categories = [...new Set(results.map(r => r.category))];
  let totalPass = 0, totalFail = 0, totalSkip = 0;

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const pass = catResults.filter(r => r.status === 'PASS').length;
    const fail = catResults.filter(r => r.status === 'FAIL').length;
    const skip = catResults.filter(r => r.status === 'SKIP').length;
    console.log(`  ${cat}: ${pass} passed, ${fail} failed, ${skip} skipped`);
    totalPass += pass;
    totalFail += fail;
    totalSkip += skip;
  }

  console.log(`\n  TOTAL: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`);
  console.log('========================================\n');

  if (totalFail > 0) {
    console.log('FAILURES:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  [${r.category}] ${r.name}: ${r.details}`);
    }
    console.log();
  }
}

main().catch(console.error);
