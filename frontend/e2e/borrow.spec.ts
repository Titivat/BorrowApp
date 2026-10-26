import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
async function loginApi(
  request: APIRequestContext,
  email = "admin@example.test",
  password = "Test-Only-Password123!",
) {
  let session = await (await request.get("/api/session")).json();
  expect(
    (
      await request.post("/api/login", {
        headers: { "X-CSRF-TOKEN": session.csrfToken },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  session = await (await request.get("/api/session")).json();
  return { "X-CSRF-TOKEN": session.csrfToken };
}
async function loginUi(page: Page) {
  await page.goto("/");
  await page.getByLabel("Company email").fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Test-Only-Password123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Equipment, accounted for." }),
  ).toBeVisible();
}
const tomorrow = () => new Date(Date.now() + 86400000).toISOString();

test("requires authentication and CSRF, validates uploads, restricts staff administration", async ({
  request,
  playwright,
}) => {
  expect((await request.get("/api/items")).status()).toBe(401);
  expect(
    (
      await request.post("/api/login", {
        data: {
          email: "admin@example.test",
          password: "Test-Only-Password123!",
        },
      })
    ).status(),
  ).toBe(400);
  const headers = await loginApi(request);
  expect(
    (
      await request.post("/api/items", {
        headers,
        data: { name: "", assetTag: "", category: "", location: "", notes: "" },
      })
    ).status(),
  ).toBe(400);
  const item = await (
    await request.post("/api/items", {
      headers,
      data: {
        name: "Security test device",
        assetTag: "SEC-001",
        category: "Testing",
        location: "Lab",
        notes: "",
      },
    })
  ).json();
  expect(
    (
      await request.post(`/api/items/${item.id}/photo`, {
        headers,
        multipart: {
          photo: {
            name: "bad.png",
            mimeType: "image/png",
            buffer: Buffer.from("<script>bad</script>"),
          },
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/users", {
        headers,
        data: {
          email: "staff@example.test",
          password: "Staff-Test-Password123!",
          role: "Staff",
        },
      })
    ).status(),
  ).toBe(200);
  const staff = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5173",
  });
  const staffHeaders = await loginApi(
    staff,
    "staff@example.test",
    "Staff-Test-Password123!",
  );
  expect((await staff.get("/api/users")).status()).toBe(403);
  expect(
    (
      await staff.post("/api/users", {
        headers: staffHeaders,
        data: {
          email: "other@example.test",
          password: "Staff-Test-Password123!",
          role: "Admin",
        },
      })
    ).status(),
  ).toBe(403);
  expect((await staff.get("/api/items")).status()).toBe(200);
  await staff.dispose();
});

test("prevents duplicate reservations and invalid transitions; reminders are idempotent", async ({
  request,
}) => {
  const headers = await loginApi(request);
  const item = await (
    await request.post("/api/items", {
      headers,
      data: {
        name: "Concurrency test device",
        assetTag: "RACE-001",
        category: "Testing",
        location: "Lab",
        notes: "",
      },
    })
  ).json();
  const data = {
    itemId: item.id,
    borrowerName: "Taylor Test",
    borrowerEmail: "taylor@example.test",
    department: "QA",
    purpose: "Concurrency test",
    dueAt: tomorrow(),
  };
  const responses = await Promise.all([
    request.post("/api/loans", { headers, data }),
    request.post("/api/loans", { headers, data }),
  ]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
  const loan = await responses.find((r) => r.status() === 200)!.json();
  expect(
    (
      await request.post(`/api/loans/${loan.id}/return`, {
        headers,
        data: { notes: "" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`/api/loans/${loan.id}/approve`, {
        headers,
        data: { notes: "" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`/api/loans/${loan.id}/approve`, {
        headers,
        data: { notes: "" },
      })
    ).status(),
  ).toBe(409);
  await request.post("/api/reminders/run", { headers });
  await request.post("/api/reminders/run", { headers });
  const reminders = await (await request.get("/api/reminders")).json();
  expect(
    reminders.entries.filter((r: { loanId: string }) => r.loanId === loan.id),
  ).toHaveLength(1);
  expect((await request.post("/api/jobs/reminders")).status()).toBe(401);
  expect(
    (
      await request.post(`/api/loans/${loan.id}/return`, {
        headers,
        data: { notes: "All accessories returned" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`/api/loans/${loan.id}/return`, {
        headers,
        data: { notes: "" },
      })
    ).status(),
  ).toBe(409);
});

test("staff can add a photo, request, approve and return equipment with an audit trail", async ({
  page,
}, testInfo) => {
  await loginUi(page);
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Item name").fill("MacBook Air 13-inch");
  await page.getByLabel("Asset tag").fill("IT-101");
  await page.getByLabel("Category", { exact: true }).fill("Laptops");
  await page.getByLabel("Location").fill("Bangkok · IT storage");
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Includes USB-C charger and sleeve.");
  await page
    .getByLabel("Item photo", { exact: false })
    .setInputFiles({
      name: "equipment.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const card = page
    .locator(".item-card")
    .filter({ hasText: "MacBook Air 13-inch" });
  await expect(
    card.getByRole("img", { name: "MacBook Air 13-inch", exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Create loan request" }).click();
  await page.getByLabel("Borrower name").fill("Nina Chen");
  await page.getByLabel("Borrower email").fill("nina@example.test");
  await page.getByLabel("Department / organization").fill("Design");
  await page
    .getByLabel("Due date")
    .fill(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  await page.getByLabel("Purpose").fill("Customer research workshop");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Approvals/ }).click();
  const row = page.getByRole("row").filter({ hasText: "Nina Chen" });
  await expect(row).toContainText("Pending");
  await page.screenshot({
    path: testInfo.outputPath("approval-proof.png"),
    fullPage: true,
  });
  await testInfo.attach("Approval queue", {
    path: testInfo.outputPath("approval-proof.png"),
    contentType: "image/png",
  });
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Loans", exact: true }).click();
  const loanRow = page.getByRole("row").filter({ hasText: "Nina Chen" });
  await expect(loanRow).toContainText("Borrowed");
  await loanRow.getByRole("button", { name: "Return", exact: true }).click();
  await page
    .getByLabel("Condition / return notes")
    .fill("Good condition, charger received.");
  await page.getByRole("button", { name: "Confirm return" }).click();
  await expect(loanRow).toContainText("Returned");
  await page.screenshot({
    path: testInfo.outputPath("return-proof.png"),
    fullPage: true,
  });
  await testInfo.attach("Completed return", {
    path: testInfo.outputPath("return-proof.png"),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("Loan returned", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Photo updated", { exact: true })).toBeVisible();
});

test("rejecting a request releases the item, and dashboard works on mobile", async ({
  page,
  request,
}, testInfo) => {
  const headers = await loginApi(request);
  for (const [name, tag, category] of [
    ["Dell UltraSharp 27", "IT-201", "Displays"],
    ["Sony Alpha a6400", "IT-202", "Cameras"],
    ["Logitech MX Keys", "IT-203", "Accessories"],
    ["iPad Air", "IT-204", "Tablets"],
  ]) {
    const item = await (
      await request.post("/api/items", {
        headers,
        data: {
          name,
          assetTag: tag,
          category,
          location: "Bangkok office",
          notes: "",
        },
      })
    ).json();
    if (tag === "IT-201" || tag === "IT-202") {
      const loan = await (
        await request.post("/api/loans", {
          headers,
          data: {
            itemId: item.id,
            borrowerName: tag === "IT-201" ? "Alex Morgan" : "Sam Park",
            borrowerEmail: "demo@example.test",
            department: tag === "IT-201" ? "Engineering" : "Marketing",
            purpose: "Team project",
            dueAt: tomorrow(),
          },
        })
      ).json();
      await request.post(`/api/loans/${loan.id}/approve`, {
        headers,
        data: { notes: "" },
      });
    }
    if (tag === "IT-203") {
      const loan = await (
        await request.post("/api/loans", {
          headers,
          data: {
            itemId: item.id,
            borrowerName: "Jamie Lee",
            borrowerEmail: "jamie@example.test",
            department: "Operations",
            purpose: "Workshop",
            dueAt: tomorrow(),
          },
        })
      ).json();
      expect(
        (
          await request.post(`/api/loans/${loan.id}/reject`, {
            headers,
            data: { notes: "" },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await request.post("/api/loans", {
            headers,
            data: {
              itemId: item.id,
              borrowerName: "Jamie Lee",
              borrowerEmail: "jamie@example.test",
              department: "Operations",
              purpose: "Revised request",
              dueAt: tomorrow(),
            },
          })
        ).status(),
      ).toBe(200);
    }
  }
  await loginUi(page);
  await page.screenshot({
    path: testInfo.outputPath("dashboard-desktop.png"),
    fullPage: true,
  });
  await testInfo.attach("Desktop dashboard", {
    path: testInfo.outputPath("dashboard-desktop.png"),
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Equipment, accounted for." }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    overflow: [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        right: e.getBoundingClientRect().right,
      })),
  }));
  expect(dimensions.width, JSON.stringify(dimensions)).toBe(390);
  await page.screenshot({
    path: testInfo.outputPath("dashboard-mobile.png"),
    fullPage: true,
  });
  await testInfo.attach("Mobile dashboard", {
    path: testInfo.outputPath("dashboard-mobile.png"),
    contentType: "image/png",
  });
});
