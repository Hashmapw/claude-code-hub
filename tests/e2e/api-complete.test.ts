/**
 * 用户和 API Key 管理完整 E2E 测试
 *
 * 📋 测试范围：
 * - 用户 CRUD 操作
 * - Key CRUD 操作
 * - 完整业务流程
 *
 * ✅ 全部通过的自动化测试脚本
 *
 * 🔑 认证方式：Cookie (auth-token)
 * ⚙️ 前提：开发服务器运行在 http://localhost:4000
 * 🧹 清理：测试完成后自动清理数据
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loginAndGetAuthToken } from "./_helpers/auth";

// ==================== 配置 ====================

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000/api/actions";
const ADMIN_KEY = process.env.TEST_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
const run = ADMIN_KEY ? describe : describe.skip;

let authToken: string | undefined;

const testData = {
  userIds: [] as number[],
};

// ==================== 辅助函数 ====================

beforeAll(async () => {
  if (!ADMIN_KEY) return;
  authToken = await loginAndGetAuthToken(API_BASE_URL, ADMIN_KEY);
});

async function callApi(module: string, action: string, body: Record<string, unknown> = {}) {
  if (!authToken) {
    throw new Error("E2E tests require ADMIN_TOKEN/TEST_ADMIN_TOKEN (used to login)");
  }

  const response = await fetch(`${API_BASE_URL}/${module}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      Cookie: `auth-token=${authToken}`,
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const data = await response.json();
    return { response, data };
  }

  const text = await response.text();
  return { response, data: { ok: false, error: `非JSON响应: ${text}` } };
}

async function expectSuccess(module: string, action: string, body: Record<string, unknown> = {}) {
  const { response, data } = await callApi(module, action, body);
  expect(response.ok).toBe(true);
  expect(data.ok).toBe(true);
  return data.data;
}

// ==================== 测试清理 ====================

afterAll(async () => {
  if (!authToken) return;

  console.log(`\n🧹 清理 ${testData.userIds.length} 个测试用户...`);
  for (const userId of testData.userIds) {
    try {
      await callApi("users", "removeUser", { userId });
    } catch (_e) {
      // 忽略清理错误
    }
  }
  console.log("✅ 清理完成\n");
});

// ==================== 测试 ====================

run("用户和 Key 管理 - E2E 测试", () => {
  let user1Id: number;
  let user2Id: number;

  test("✅ 1. 创建第一个用户", async () => {
    const result = await expectSuccess("users", "addUser", {
      name: `E2E用户1_${Date.now()}`,
      note: "测试用户1",
      rpm: 100,
      dailyQuota: 50,
    });

    expect(result.user).toBeDefined();
    expect(result.defaultKey).toBeDefined();
    expect(result.defaultKey.key).toMatch(/^sk-[a-f0-9]{32}$/);

    user1Id = result.user.id;
    testData.userIds.push(user1Id);
    console.log(`   ✅ 用户1 ID: ${user1Id}`);
  });

  test("✅ 2. 创建第二个用户（带限额）", async () => {
    const result = await expectSuccess("users", "addUser", {
      name: `E2E用户2_${Date.now()}`,
      rpm: 200,
      dailyQuota: 100,
      limit5hUsd: 50,
      limitWeeklyUsd: 300,
      tags: ["test"],
    });

    user2Id = result.user.id;
    testData.userIds.push(user2Id);
    console.log(`   ✅ 用户2 ID: ${user2Id}`);
  });

  test("✅ 3. 获取用户列表", async () => {
    const users = await expectSuccess("users", "getUsers");
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThanOrEqual(2);

    const user1 = users.find((u: any) => u.id === user1Id);
    expect(user1).toBeDefined();
  });

  test("✅ 4. 编辑用户信息", async () => {
    await expectSuccess("users", "editUser", {
      userId: user1Id,
      rpm: 150,
      dailyQuota: 80,
    });

    const users = await expectSuccess("users", "getUsers");
    const user = users.find((u: any) => u.id === user1Id);
    expect(user.rpm).toBe(150);
  });

  test("✅ 5. 禁用和启用用户（通过 editUser）", async () => {
    // 禁用用户
    await expectSuccess("users", "editUser", {
      userId: user1Id,
      isEnabled: false,
    });

    let users = await expectSuccess("users", "getUsers");
    let user = users.find((u: any) => u.id === user1Id);
    expect(user.isEnabled).toBe(false);

    // 启用用户
    await expectSuccess("users", "editUser", {
      userId: user1Id,
      isEnabled: true,
    });

    users = await expectSuccess("users", "getUsers");
    user = users.find((u: any) => u.id === user1Id);
    expect(user.isEnabled).toBe(true);
  });

  test("✅ 6. 获取用户的 Keys", async () => {
    const keys = await expectSuccess("keys", "getKeys", { userId: user1Id });
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThanOrEqual(1);

    // 验证 Key 格式（管理员可能看到完整 Key 或脱敏 Key）
    const keyValue = keys[0].key;
    const isFullKey = /^sk-[a-f0-9]{32}$/.test(keyValue); // 完整 Key
    const isMaskedKey = /^sk-\*+[a-f0-9]{8}$/.test(keyValue); // 脱敏 Key

    expect(isFullKey || isMaskedKey).toBe(true);
  });

  test("✅ 7. 为用户创建新 Key", async () => {
    const result = await expectSuccess("keys", "addKey", {
      userId: user1Id,
      name: `E2EKey_${Date.now()}`,
    });

    expect(result.generatedKey).toMatch(/^sk-[a-f0-9]{32}$/);
    console.log(`   ✅ Key: ${result.generatedKey}`);
  });

  test("✅ 8. 创建带限额的 Key", async () => {
    const result = await expectSuccess("keys", "addKey", {
      userId: user2Id,
      name: `E2E限额Key_${Date.now()}`,
      limitDailyUsd: 5,
      limit5hUsd: 10,
    });

    expect(result.generatedKey).toBeDefined();
  });

  test("✅ 9. 验证 Key 数量", async () => {
    const keys = await expectSuccess("keys", "getKeys", { userId: user1Id });
    expect(keys.length).toBeGreaterThanOrEqual(2); // 默认Key + 新建的Key
  });

  test("✅ 10. 完整流程测试", async () => {
    // 创建用户
    const createResult = await expectSuccess("users", "addUser", {
      name: `E2E完整流程_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
    });

    const userId = createResult.user.id;
    testData.userIds.push(userId);

    // 创建额外Key
    await expectSuccess("keys", "addKey", {
      userId,
      name: `流程Key1_${Date.now()}`,
    });

    await expectSuccess("keys", "addKey", {
      userId,
      name: `流程Key2_${Date.now()}`,
    });

    // 验证 Keys
    const keys = await expectSuccess("keys", "getKeys", { userId });
    expect(keys.length).toBe(3); // 1默认 + 2新建

    // 删除用户（自动删除所有Keys）
    await expectSuccess("users", "removeUser", { userId });

    // 验证已删除
    const users = await expectSuccess("users", "getUsers");
    const deletedUser = users.find((u: any) => u.id === userId);
    expect(deletedUser).toBeUndefined();

    console.log(`   ✅ 完整流程通过`);
  });
});
