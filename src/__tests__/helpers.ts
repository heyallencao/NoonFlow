import { type Page, type Locator, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** Navigate to the chat page and wait for it to be ready. */
export async function goToChat(page: Page) {
  await page.goto('/chat');
  await waitForPageReady(page);
}

/** Navigate to a specific conversation. */
export async function goToConversation(page: Page, id: string) {
  await page.goto(`/chat/${id}`);
  await waitForPageReady(page);
}

/** Navigate to the plugins / skills page. */
export async function goToPlugins(page: Page) {
  await page.goto('/plugins');
  await waitForPageReady(page);
}

/** Navigate to the MCP management page. */
export async function goToMCP(page: Page) {
  await page.goto('/plugins/mcp');
  await waitForPageReady(page);
}

/** Navigate to the settings page. */
export async function goToSettings(page: Page) {
  await page.goto('/settings');
  await waitForPageReady(page);
}

/** Navigate to the settings page with a specific tab selected. */
export async function goToSettingsTab(page: Page, tab: string) {
  await page.goto(`/settings?tab=${tab}`);
  await waitForPageReady(page);
}

// ---------------------------------------------------------------------------
// Wait / loading helpers
// ---------------------------------------------------------------------------

/** Wait until the page has finished its initial load. */
export async function waitForPageReady(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

/** Wait for streaming dots indicator to appear (3 bouncing dots). */
export async function waitForStreamingStart(page: Page) {
  // The streaming indicator is either bouncing dots or a cursor pulse
  await page.locator('.animate-bounce, .animate-pulse').first().waitFor({ state: 'visible', timeout: 15_000 });
}

/** Wait for streaming to finish -- the stop button disappears and send button returns. */
export async function waitForStreamingEnd(page: Page) {
  await page.locator('button[title="Send message"]').waitFor({ state: 'visible', timeout: 120_000 });
}

// ---------------------------------------------------------------------------
// Chat helpers
// ---------------------------------------------------------------------------

/** Type a message into the chat input and send it. */
export async function sendMessage(page: Page, message: string) {
  const input = chatInput(page);
  await input.fill(message);
  await input.press('Enter');
}

/** Get all message role labels ("You" or "Claude") as an array. */
export async function getMessageRoles(page: Page): Promise<string[]> {
  const labels = page.locator('.text-xs.font-medium.text-muted-foreground');
  return labels.allInnerTexts();
}

// ---------------------------------------------------------------------------
// Common locators
// ---------------------------------------------------------------------------

/** The main chat textarea. */
export function chatInput(page: Page): Locator {
  return page.locator('main').locator(
    [
      'textarea[placeholder*="Message Claude"]',
      'textarea[placeholder*="Message Codex"]',
      'textarea[placeholder*="Send a message"]',
      'textarea',
      '[role="textbox"]',
    ].join(', ')
  ).first();
}

/** The send button (paper plane icon). */
export function sendButton(page: Page): Locator {
  return page.locator('button[aria-label="Submit"], button[title="Send message"]');
}

/** The stop button (square icon, destructive variant). */
export function stopButton(page: Page): Locator {
  return page.locator('button[aria-label="Stop"], button[title="Stop generating"]');
}

/** The "New Chat" link in the sidebar. */
export function newChatButton(page: Page): Locator {
  return page.locator('aside a:has-text("New Chat")');
}

/** The sidebar <aside> element. */
export function sidebar(page: Page): Locator {
  return page.locator('aside');
}

/** The sidebar toggle button in the header (sr-only text "Toggle sidebar"). */
export function sidebarToggle(page: Page): Locator {
  return page.locator('header button:has(.sr-only:text("Toggle sidebar"))');
}

/** The theme toggle button in the header (sr-only text "Toggle theme"). */
export function themeToggle(page: Page): Locator {
  return page.locator('header button:has(.sr-only:text("Toggle theme"))');
}

/** A sidebar nav link by its exact label text. */
export function navLink(page: Page, label: string): Locator {
  return page.locator('aside nav a').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
}

/** Chat session links in the sidebar (links to /chat/[id]). */
export function sessionLinks(page: Page): Locator {
  return page.locator('aside a[href^="/chat/"]');
}

/** The search input on the plugins page. */
export function pluginSearchInput(page: Page): Locator {
  return page.locator('input[placeholder*="Search skills"]');
}

/** The "Add Server" button on the MCP page. */
export function addServerButton(page: Page): Locator {
  return page.locator('button:has-text("Add Server")');
}

/** The save button on the settings page. */
export function settingsSaveButton(page: Page): Locator {
  return page.locator('button:has-text("Save Changes"), button:has-text("Save JSON")');
}

/** The reset button on the settings page. */
export function settingsResetButton(page: Page): Locator {
  return page.locator('button:has-text("Reset")');
}

/** The "Visual Editor" tab button on the settings page. */
export function settingsVisualTab(page: Page): Locator {
  return page.locator('button:has-text("Visual Editor")');
}

/** The "JSON Editor" tab button on the settings page. */
export function settingsJsonTab(page: Page): Locator {
  return page.locator('button:has-text("JSON Editor")');
}

// ---------------------------------------------------------------------------
// Right Panel locators (V2)
// ---------------------------------------------------------------------------

/** The right panel <aside> element (w-80, border-l). Distinct from sidebar. */
export function rightPanel(page: Page): Locator {
  return page.locator('aside.w-80');
}

/** The collapsed right panel icon strip (when panel is closed). */
export function rightPanelCollapsed(page: Page): Locator {
  return page.locator('div.border-l button:has(.sr-only:text("Open panel"))');
}

/** The "Files" tab button in the right panel header. */
export function panelFilesTab(page: Page): Locator {
  return page.locator('aside.w-80 button:has-text("Files")');
}

/** The "Tasks" tab button in the right panel header. */
export function panelTasksTab(page: Page): Locator {
  return page.locator('aside.w-80 button:has-text("Tasks")');
}

/** The close panel button (PanelRightClose icon with sr-only "Close panel"). */
export function panelCloseButton(page: Page): Locator {
  return page.locator('button:has(.sr-only:text("Close panel"))');
}

/** The open panel button (FolderTree icon with sr-only "Open panel"). */
export function panelOpenButton(page: Page): Locator {
  return page.locator('button:has(.sr-only:text("Open panel"))');
}

// ---------------------------------------------------------------------------
// File Tree helpers (V2)
// ---------------------------------------------------------------------------

/** The file search/filter input in the right panel. */
export function fileSearchInput(page: Page): Locator {
  return page.locator('input[placeholder*="Filter files"]');
}

/** The refresh button in the file tree header (sr-only "Refresh"). */
export function fileTreeRefreshButton(page: Page): Locator {
  return page.locator('button:has(.sr-only:text("Refresh"))');
}

/** All directory nodes in the file tree (buttons containing folder icons). */
export function fileTreeDirectories(page: Page): Locator {
  return page.locator('aside.w-80 button:has(svg.text-blue-500)');
}

/** All file nodes in the file tree (buttons containing file icons). */
export function fileTreeFiles(page: Page): Locator {
  return page.locator('aside.w-80 button:has(svg.text-muted-foreground)');
}

/** Click a file tree node by name. */
export async function clickFileTreeNode(page: Page, name: string) {
  await page.locator(`aside.w-80 button:has-text("${name}")`).click();
}

/** Expand or collapse a directory node by name. */
export async function toggleDirectory(page: Page, dirName: string) {
  await page.locator(`aside.w-80 button:has-text("${dirName}")`).first().click();
}

// ---------------------------------------------------------------------------
// File Preview helpers (V2)
// ---------------------------------------------------------------------------

/** The "Back to file tree" button in file preview. */
export function filePreviewBackButton(page: Page): Locator {
  return page.locator('button:has(.sr-only:text("Back to file tree"))');
}

/** The "Copy path" button in file preview. */
export function filePreviewCopyButton(page: Page): Locator {
  return page.locator('button:has(.sr-only:text("Copy path"))');
}

/** The language badge in file preview. */
export function filePreviewLanguageBadge(page: Page): Locator {
  return page.locator('aside.w-80 .text-\\[10px\\]').first();
}

/** The line count text in file preview. */
export function filePreviewLineCount(page: Page): Locator {
  return page.locator('aside.w-80 span:has-text("lines")');
}

/** The syntax highlighter container in file preview. */
export function filePreviewCode(page: Page): Locator {
  return page.locator('aside.w-80 code, aside.w-80 pre');
}

// ---------------------------------------------------------------------------
// Task panel helpers (V2)
// ---------------------------------------------------------------------------

/** Switch the right panel to the Tasks tab. */
export async function switchToTasksTab(page: Page) {
  await panelTasksTab(page).click();
  await page.waitForTimeout(200);
}

/** Switch the right panel to the Files tab. */
export async function switchToFilesTab(page: Page) {
  await panelFilesTab(page).click();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Skills Editor helpers (V2)
// ---------------------------------------------------------------------------

/** The skills search input in the settings skills editor. */
export function skillsSearchInput(page: Page): Locator {
  return page.locator('input[placeholder*="Search"]').first();
}

/** All skill list items in the skills editor. */
export function skillListItems(page: Page): Locator {
  return page.locator('[class*="cursor-pointer"]:has(.truncate)');
}

/** Click a skill by name in the skills list. */
export async function selectSkill(page: Page, name: string) {
  await page.locator(`text=/${name}`).click();
  await page.waitForTimeout(200);
}

/** The primary "New Skill" button in the skills editor header (next to heading). */
export function createSkillButton(page: Page): Locator {
  return page.getByRole('button', { name: 'New Skill' }).first();
}

/** The skill editor textarea/content area. */
export function skillEditorContent(page: Page): Locator {
  return page.locator('textarea.font-mono, [contenteditable="true"]').first();
}

/** The skill save button. */
export function skillSaveButton(page: Page): Locator {
  return page.locator('button:has-text("Save")');
}

/** The skill preview toggle. */
export function skillPreviewToggle(page: Page): Locator {
  return page.locator('button:has-text("Preview")');
}

/** The skill edit toggle (switch back from preview). */
export function skillEditToggle(page: Page): Locator {
  return page.locator('button:has-text("Edit")');
}

/** Skill source badge (global or project). */
export function skillSourceBadge(page: Page, source: 'global' | 'project'): Locator {
  return page.locator(`[class*="badge"]:has-text("${source}")`);
}

/** The skill delete button (trash icon, appears on hover). */
export function skillDeleteButton(page: Page): Locator {
  return page.locator('button:has(svg.lucide-trash-2)');
}

// ---------------------------------------------------------------------------
// Code Block verification helpers (V2)
// ---------------------------------------------------------------------------

/** All code blocks in the chat messages area. */
export function codeBlocks(page: Page): Locator {
  return page.locator('.group.not-prose');
}

/** The language label in a code block header. */
export function codeBlockLanguageLabel(page: Page): Locator {
  return page.locator('.bg-zinc-800 span, .bg-zinc-900 span').first();
}

/** The copy button within a code block. */
export function codeBlockCopyButton(page: Page): Locator {
  return page.locator('button[title="Copy code"]');
}

/** All tool call/result blocks in the message area. */
export function toolBlocks(page: Page): Locator {
  return page.locator('.rounded-lg.border.bg-muted\/50');
}

/** Tool call labels (blue "Tool Call" text). */
export function toolCallLabels(page: Page): Locator {
  return page.locator('span.text-blue-600, span.dark\:text-blue-400').filter({ hasText: 'Tool Call' });
}

/** Tool result labels (green "Tool Result" text). */
export function toolResultLabels(page: Page): Locator {
  return page.locator('span.text-green-600, span.dark\:text-green-400').filter({ hasText: 'Tool Result' });
}

/** User message avatar circles. */
export function userAvatar(page: Page): Locator {
  return page.locator('.bg-secondary.rounded-full:has(svg.lucide-user)');
}

/** Assistant message avatar circles. */
export function assistantAvatar(page: Page): Locator {
  return page.locator('.bg-primary.rounded-full:has(svg.lucide-bot)');
}

/** Token usage display container. */
export function tokenUsageDisplay(page: Page): Locator {
  return page.locator('.flex.flex-wrap.gap-3:has(span:has-text("In:"))');
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Collect console errors during the test. Call before navigation. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

/** Filter out known non-critical console errors. */
export function filterCriticalErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('hydrat') &&
      !e.includes('Warning:') &&
      !e.includes('DevTools')
  );
}

/** Assert that the page loaded within the given time budget (ms). */
export async function expectPageLoadTime(page: Page, url: string, maxMs: number = 3000) {
  const start = Date.now();
  await page.goto(url);
  await waitForPageReady(page);
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(maxMs);
}
