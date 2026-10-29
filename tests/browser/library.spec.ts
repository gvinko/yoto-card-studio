import { test, expect, type Page } from "@playwright/test";

async function enableParentPin(page: Page) {
  // The editor is accessible by default on a fresh browser; an existing PIN still locks it.
  await expect(page.getByRole("button", { name: "Child view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  // PIN setup remains available to users who already configured it; do not force it here.
}

test("parent imports music, shares it with child, and returns locked after reload", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Yoto Card Studio" }),
  ).toBeVisible();
  await enableParentPin(page);
  await page.getByLabel("Add local audio").setInputFiles({
    name: "Family song.wav",
    mimeType: "audio/wav",
    buffer: Buffer.alloc(100),
  });
  await expect(
    page.getByText("Family song.wav", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share with Evie" }).click();
  await page.getByRole("button", { name: "Child view" }).click();
  await expect(
    page.getByRole("button", { name: "Play Family song.wav" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("child-library.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Play Family song.wav" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
});
test("story survives reload and child library stays offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await enableParentPin(page);
  await page.getByLabel("Story title").fill("The little moon");
  await page
    .getByLabel("Your original story")
    .fill("Evie and the moon counted three sleepy stars.");
  await page.getByRole("button", { name: "Save story" }).click();
  await expect(
    page.getByText("The little moon", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share with Evie" }).click();
  await page.getByRole("button", { name: "Child view" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("The little moon", { exact: true }),
  ).toBeVisible();
});
test("library backup restores audio as new parent-only copies", async ({
  page,
}) => {
  await page.goto("/");
  await enableParentPin(page);
  await page.getByLabel("Add local audio").setInputFiles({
    name: "Backup song.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("original-audio-bytes"),
  });
  await expect(
    page.getByText("Backup song.wav", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Back up library" }).click();
  const downloaded = await promise;
  const file = (await downloaded.path())!;
  await page.getByLabel("Restore backup").setInputFiles(file);
  await expect(
    page.getByText(
      "1 records restored as new copies. Review them before sharing with Evie.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByText("Backup song.wav", { exact: true })).toHaveCount(
    2,
  );
  await page.getByRole("button", { name: "Child view" }).click();
  await expect(page.getByText("Backup song.wav", { exact: true })).toHaveCount(
    0,
  );
});
test("real WAV import, chapter recovery, and FFmpeg export preserve project", async ({
  page,
}) => {
  test.setTimeout(120000);
  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(16000, 40);
  await page.goto("/");
  await enableParentPin(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "Moon.wav", mimeType: "audio/wav", buffer: wav });
  await expect(
    page.getByRole("button", { name: "Chapters", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("Draft saved on this device")).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("button", { name: "Build 1 tracks", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download ZIP (tracks + icons)" }),
  ).toBeEnabled({ timeout: 60000 });
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download ZIP (tracks + icons)" })
    .click();
  const zip = await pending;
  expect(zip.suggestedFilename()).toContain("Moon");
  await page.getByLabel("Playlist / album title").fill("Moon edited");
  await expect(page.getByText("Draft saved on this device")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Child view" })).toBeVisible();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Recover previous draft" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByLabel("Playlist / album title")).toHaveValue("Moon");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByLabel("Add local audio")
    .setInputFiles({ name: "Ready.wav", mimeType: "audio/wav", buffer: wav });
  const row = page
    .locator("li")
    .filter({ has: page.getByText("Ready.wav", { exact: true }) });
  await expect(row.getByRole("button", { name: "Prepare MYO" })).toBeDisabled();
  await row.getByLabel("I have copying rights").click();
  await expect(row.getByLabel("I have copying rights")).toBeChecked();
  await row.getByRole("button", { name: "Prepare MYO" }).click();
  await expect(
    page.getByRole("button", { name: "Chapters", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
test("locking the parent area saves the final voice recording", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }),
      },
      configurable: true,
    });
    class FakeRecorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "audio/webm";
      onstop: any;
      ondataavailable: any;
      onerror: any;
      constructor(_stream: any, _options: any) {}
      start() {
        this.state = "recording";
      }
      stop() {
        if (this.state === "inactive") throw new Error("Already stopped");
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["family-voice"]) });
        setTimeout(() => this.onstop?.(), 0);
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      value: FakeRecorder,
      configurable: true,
    });
  });
  await page.goto("/");
  await enableParentPin(page);
  await page.getByRole("button", { name: "Record family voice" }).click();
  await expect(
    page.getByRole("button", { name: "Stop and save recording" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Child view" }).click();
  await expect(page.getByRole("button", { name: "Child view" })).toBeVisible();
  await expect(page.getByText(/^Family voice .*\.webm$/)).toBeVisible();
});
test("playlist playback follows the chosen sequence", async ({ page }) => {
  await page.goto("/");
  await enableParentPin(page);
  await page.getByLabel("Add local audio").setInputFiles([
    { name: "First.wav", mimeType: "audio/wav", buffer: Buffer.alloc(100) },
    { name: "Second.wav", mimeType: "audio/wav", buffer: Buffer.alloc(100) },
  ]);
  await page.getByLabel("Add Second.wav to playlist").check();
  await page.getByLabel("Add First.wav to playlist").check();
  await page.getByLabel("Playlist name").fill("Bedtime");
  await page.getByRole("button", { name: "Save playlist (2)" }).click();
  await page.getByRole("button", { name: "Play Bedtime", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Now playing" })
      .getByRole("heading", { name: "Second.wav" }),
  ).toBeVisible();
  await page
    .locator("audio")
    .evaluate((el) => el.dispatchEvent(new Event("ended")));
  await expect(
    page
      .getByRole("region", { name: "Now playing" })
      .getByRole("heading", { name: "First.wav" }),
  ).toBeVisible();
});
