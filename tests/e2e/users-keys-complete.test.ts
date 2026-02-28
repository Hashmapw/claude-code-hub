/**
 * 用户和 API Key 管理完整 E2E 测试
 *
 * 📋 测试流程：
 * 1. 创建测试用户
 * 2. 为用户创建 API Key
 * 3. 测试 Key 的查询、管理
 * 4. 测试用户的编辑、禁用/启用
 * 5. 清理测试数据
 *
 * 🔑 认证方式：
 * - 使用 Cookie: auth-token
 * - Token 从环境变量读取（ADMIN_TOKEN）
 *
 * ⚙️ 前提条件：
 * - 开发服务器运行在 http://localhost:4000
 * - PostgreSQL 和 Redis 已启动
 * - ADMIN_TOKEN 已配置在 .env 文件中
 *
 * 🧹 数据清理：
 * - 测试完成后自动清理所有创建的用户和 Key
 * - 使用 afterAll 钩子确保清理执行
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loginAndGetAuthToken } from "./_helpers/auth";

// ==================== 配置 ====================

/** API 基础 URL */
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000/api/actions";

/** 管理员认证 Key（从环境变量读取，用于登录换取会话 token）*/
const ADMIN_KEY = process.env.TEST_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
const run = ADMIN_KEY ? describe : describe.skip;

let sessionToken: string | undefined;

/** 测试数据存储（用于清理）*/
const testData = {
  /** 创建的用户 ID 列表 */
  userIds: [] as number[],
  /** 创建的 Key ID 列表 */
  keyIds: [] as number[],
};

// ==================== 辅助函数 ====================

/**
 * 调用 API 端点
 *
 * @param module - 模块名（如 "users", "keys"）
 * @param action - 操作名（如 "getUsers", "addUser"）
 * @param body - 请求体参数
 * @param authToken - 认证 Token（默认使用 ADMIN_TOKEN）
 * @returns Promise<{response: Response, data: any}>
 *
 * @example
 * const { response, data } = await callApi("users", "getUsers");
 */
async function callApi(
  module: string,
  action: string,
  body: Record<string, unknown> = {},
  authToken = sessionToken
) {
  if (!authToken) {
    throw new Error("E2E tests require ADMIN_TOKEN/TEST_ADMIN_TOKEN (used to login)");
  }

  const url = `${API_BASE_URL}/${module}/${action}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      Cookie: `auth-token=${authToken}`,
    },
    body: JSON.stringify(body),
  });

  // 检查响应是否是 JSON
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const data = await response.json();
    return { response, data };
  }

  // 非 JSON 响应，返回文本
  const text = await response.text();
  return { response, data: { ok: false, error: `非JSON响应: ${text}` } };
}

/**
 * 期望 API 调用成功
 *
 * 验证：
 * - HTTP 状态码为 200
 * - 响应格式为 {ok: true, data: ...}（data 可能为 null）
 *
 * @returns data 字段的内容（可能为 null）
 *
 * @example
 * const user = await expectSuccess("users", "addUser", { name: "测试" });
 */
async function expectSuccess(module: string, action: string, body: Record<string, unknown> = {}) {
  const { response, data } = await callApi(module, action, body);

  // 验证 HTTP 状态码
  expect(response.status).toBe(200);
  expect(response.ok).toBe(true);

  // 验证响应格式
  expect(data).toHaveProperty("ok");
  expect(data.ok).toBe(true);

  // data 字段可能不存在（某些操作只返回 {ok: true}）
  return data.data;
}

/**
 * 期望 API 调用失败
 *
 * 验证：
 * - HTTP 状态码为 400（业务逻辑错误）或 401/403（认证/权限错误）
 * - 响应格式为 {ok: false, error: "..."} 或 Zod 验证错误格式 {success: false, error: {...}}
 *
 * @returns error 错误消息
 *
 * @example
 * const error = await expectError("users", "addUser", { name: "" });
 * expect(error).toContain("用户名");
 */
async function expectError(module: string, action: string, body: Record<string, unknown> = {}) {
  const { response, data } = await callApi(module, action, body);

  // API 返回 400/401/403 状态码，表示业务错误或权限问题
  expect([400, 401, 403].includes(response.status)).toBe(true);

  // 验证错误响应格式（支持两种格式）
  if (data.ok !== undefined) {
    // 标准格式：{ok: false, error: "..."}
    expect(data.ok).toBe(false);
    expect(data).toHaveProperty("error");
    return data.error;
  } else if (data.success !== undefined) {
    // Zod 验证错误格式：{success: false, error: {...}}
    expect(data.success).toBe(false);
    expect(data).toHaveProperty("error");
    // 提取 Zod 错误消息
    const zodError = data.error;
    if (zodError.issues && Array.isArray(zodError.issues)) {
      return zodError.issues.map((issue: any) => issue.message).join("; ");
    }
    return JSON.stringify(zodError);
  } else {
    throw new Error(`未知的错误响应格式: ${JSON.stringify(data)}`);
  }
}

// ==================== 测试清理 ====================

/**
 * 测试完成后清理所有创建的数据
 *
 * 清理顺序：
 * 1. 删除所有创建的 Keys
 * 2. 删除所有创建的用户
 */
afterAll(async () => {
  if (!sessionToken) return;

  console.log("\n🧹 开始清理 E2E 测试数据...");
  console.log(`   用户数：${testData.userIds.length}`);
  console.log(`   Key数：${testData.keyIds.length}`);

  // 清理用户（会自动清理关联的 Keys）
  for (const userId of testData.userIds) {
    try {
      await callApi("users", "removeUser", { userId });
    } catch (_error) {
      console.warn(`⚠️  清理用户 ${userId} 失败`);
    }
  }

  console.log("✅ E2E 测试数据清理完成\n");
});

// ==================== 测试套件 ====================

beforeAll(async () => {
  if (!ADMIN_KEY) return;
  sessionToken = await loginAndGetAuthToken(API_BASE_URL, ADMIN_KEY);
});

run("用户和 Key 管理 - 完整 E2E 测试", () => {
  // 测试用户 ID（在多个测试间共享）
  let testUser1Id: number;
  let testUser2Id: number;

  // ==================== 第1部分：用户管理 ====================

  describe("【用户管理】创建和查询", () => {
    test("1.1 应该成功创建第一个用户", async () => {
      const result = await expectSuccess("users", "addUser", {
        name: `E2E用户1_${Date.now()}`,
        note: "E2E测试用户1",
        rpm: 100,
        dailyQuota: 50,
        isEnabled: true,
      });

      // 验证返回结构
      expect(result).toHaveProperty("user");
      expect(result).toHaveProperty("defaultKey");

      // 验证用户信息
      expect(result.user.name).toContain("E2E用户1");
      expect(result.user.rpm).toBe(100);
      expect(result.user.dailyQuota).toBe(50);

      // 验证默认 Key
      expect(result.defaultKey.key).toMatch(/^sk-[a-f0-9]{32}$/);

      // 保存用户 ID 和 Key ID
      testUser1Id = result.user.id;
      testData.userIds.push(testUser1Id);

      console.log(`✅ 创建用户1成功 (ID: ${testUser1Id})`);
    });

    test("1.2 应该成功创建第二个用户（带完整限额）", async () => {
      const result = await expectSuccess("users", "addUser", {
        name: `E2E用户2_${Date.now()}`,
        note: "E2E测试用户2 - 高级配置",
        rpm: 200,
        dailyQuota: 100,
        limit5hUsd: 50,
        limitWeeklyUsd: 300,
        limitMonthlyUsd: 1000,
        limitConcurrentSessions: 10,
        tags: ["test", "premium"],
        isEnabled: true,
      });

      testUser2Id = result.user.id;
      testData.userIds.push(testUser2Id);

      // 验证高级配置
      // API 返回的金额字段是字符串格式（Decimal.js）
      expect(parseFloat(result.user.limit5hUsd)).toBe(50);
      expect(parseFloat(result.user.limitWeeklyUsd)).toBe(300);
      expect(result.user.tags).toContain("premium");

      console.log(`✅ 创建用户2成功 (ID: ${testUser2Id})`);
    });

    test("1.3 应该能查询到创建的用户", async () => {
      const users = await expectSuccess("users", "getUsers");

      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThanOrEqual(2);

      // 验证用户1存在
      const user1 = users.find((u: any) => u.id === testUser1Id);
      expect(user1).toBeDefined();
      expect(user1.name).toContain("E2E用户1");

      // 验证用户2存在
      const user2 = users.find((u: any) => u.id === testUser2Id);
      expect(user2).toBeDefined();
      expect(user2.name).toContain("E2E用户2");
    });
  });

  describe("【用户管理】编辑和状态管理", () => {
    test("2.1 应该成功编辑用户信息", async () => {
      const _result = await expectSuccess("users", "editUser", {
        userId: testUser1Id,
        name: `E2E用户1_已编辑_${Date.now()}`,
        note: "已修改",
        rpm: 150,
        dailyQuota: 80,
      });

      // editUser 返回 null，需要重新查询验证
      const users = await expectSuccess("users", "getUsers");
      const updatedUser = users.find((u: any) => u.id === testUser1Id);

      expect(updatedUser.name).toContain("已编辑");
      expect(updatedUser.rpm).toBe(150);
    });

    test("2.2 应该成功禁用用户", async () => {
      await expectSuccess("users", "editUser", {
        userId: testUser1Id,
        name: `E2E用户1_${Date.now()}`, // 必填字段
        isEnabled: false,
      });

      // 验证用户已禁用
      const users = await expectSuccess("users", "getUsers");
      const user = users.find((u: any) => u.id === testUser1Id);
      expect(user.isEnabled).toBe(false);
    });

    test("2.3 应该成功启用用户", async () => {
      await expectSuccess("users", "editUser", {
        userId: testUser1Id,
        name: `E2E用户1_${Date.now()}`, // 必填字段
        isEnabled: true,
      });

      // 验证用户已启用
      const users = await expectSuccess("users", "getUsers");
      const user = users.find((u: any) => u.id === testUser1Id);
      expect(user.isEnabled).toBe(true);
    });
  });

  // ==================== 第2部分：API Key 管理 ====================

  describe("【Key 管理】创建和查询", () => {
    test("3.1 应该能获取用户的 Keys（包含默认 Key）", async () => {
      const keys = await expectSuccess("keys", "getKeys", {
        userId: testUser1Id,
      });

      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThanOrEqual(1); // 至少有默认 Key

      // 验证 Key 结构
      const key = keys[0];
      expect(key).toHaveProperty("id");
      expect(key).toHaveProperty("userId");
      expect(key).toHaveProperty("key");
      expect(key).toHaveProperty("name");

      // 验证 Key 格式（getKeys 返回完整 key，不是脱敏格式）
      expect(key.key).toMatch(/^sk-[a-f0-9]{32}$/);
    });

    test("3.2 应该成功为用户创建新 Key", async () => {
      const result = await expectSuccess("keys", "addKey", {
        userId: testUser1Id,
        name: `E2E测试Key_${Date.now()}`,
      });

      // 验证返回格式（根据实际 API）
      expect(result).toHaveProperty("generatedKey");
      expect(result).toHaveProperty("name");

      // 验证 Key 格式
      expect(result.generatedKey).toMatch(/^sk-[a-f0-9]{32}$/);

      console.log(`✅ 创建 Key 成功: ${result.name}`);
    });

    test("3.3 应该成功创建带限额的 Key", async () => {
      const result = await expectSuccess("keys", "addKey", {
        userId: testUser2Id,
        name: `E2E限额Key_${Date.now()}`,
        limitDailyUsd: 5,
        limit5hUsd: 10,
        limitWeeklyUsd: 50,
        limitMonthlyUsd: 200,
      });

      expect(result.generatedKey).toMatch(/^sk-[a-f0-9]{32}$/);

      console.log(`✅ 创建限额 Key 成功: ${result.name}`);
    });

    test("3.4 应该拒绝为不存在的用户创建 Key", async () => {
      const error = await expectError("keys", "addKey", {
        userId: 999999,
        name: "无效用户的Key",
      });

      expect(error).toBeDefined();
      expect(typeof error).toBe("string");
    });
  });

  describe("【Key 管理】删除操作", () => {
    let tempUserId: number;
    let tempKeyId: number;

    beforeAll(async () => {
      // 创建临时用户用于测试 Key 删除
      const userResult = await expectSuccess("users", "addUser", {
        name: `E2E临时用户_${Date.now()}`,
        rpm: 60,
        dailyQuota: 10,
      });

      tempUserId = userResult.user.id;
      testData.userIds.push(tempUserId);

      // 创建额外的 Key
      const _keyResult = await expectSuccess("keys", "addKey", {
        userId: tempUserId,
        name: `临时Key_${Date.now()}`,
      });

      // 获取 Key ID（需要查询 getKeys）
      const keys = await expectSuccess("keys", "getKeys", { userId: tempUserId });
      const createdKey = keys.find((k: any) => k.name.includes("临时Key"));
      tempKeyId = createdKey.id;
    });

    test("4.1 应该成功删除 Key", async () => {
      // 删除刚创建的 Key
      await expectSuccess("keys", "removeKey", { keyId: tempKeyId });

      // 验证 Key 已被删除
      const keys = await expectSuccess("keys", "getKeys", { userId: tempUserId });
      const deletedKey = keys.find((k: any) => k.id === tempKeyId);
      expect(deletedKey).toBeUndefined();

      console.log(`✅ 删除 Key ${tempKeyId} 成功`);
    });

    test("4.2 应该拒绝删除不存在的 Key", async () => {
      const error = await expectError("keys", "removeKey", {
        keyId: 999999,
      });

      expect(error).toBeDefined();
    });

    test("4.3 应该拒绝删除用户的最后一个 Key", async () => {
      // 获取剩余的 Keys
      const keys = await expectSuccess("keys", "getKeys", { userId: tempUserId });
      expect(keys.length).toBe(1); // 只剩默认 Key

      const lastKeyId = keys[0].id;

      // 尝试删除最后一个 Key
      const error = await expectError("keys", "removeKey", {
        keyId: lastKeyId,
      });

      expect(error).toBeDefined();
      expect(error).toContain("至少");
    });
  });

  // ==================== 第3部分：参数验证 ====================

  describe("【参数验证】边界条件测试", () => {
    test("5.1 创建用户 - 应该拒绝空用户名", async () => {
      const error = await expectError("users", "addUser", {
        name: "",
        rpm: 60,
        dailyQuota: 10,
      });

      expect(error).toBeDefined();
    });

    test("5.2 创建用户 - 应该拒绝无效的 RPM", async () => {
      const error = await expectError("users", "addUser", {
        name: "测试",
        rpm: -1, // 负数无效，0 表示无限制
        dailyQuota: 10,
      });

      expect(error).toBeDefined();
    });

    test("5.3 创建用户 - 应该拒绝负数配额", async () => {
      const error = await expectError("users", "addUser", {
        name: "测试",
        rpm: 60,
        dailyQuota: -10, // 负数
      });

      expect(error).toBeDefined();
    });

    test("5.4 编辑用户 - 幂等操作（编辑不存在的用户也返回成功）", async () => {
      // 注意：editUser 对不存在的用户是幂等操作，不会报错
      // 这与 removeUser 的行为一致
      const { response, data } = await callApi("users", "editUser", {
        userId: 999999,
        name: "不存在",
      });

      // 验证返回成功（幂等操作）
      expect(response.ok).toBe(true);
      expect(data.ok).toBe(true);
    });

    test("5.5 删除用户 - 幂等操作（删除不存在的用户也返回成功）", async () => {
      // 删除不存在的用户是幂等操作，返回 {ok: true}
      await expectSuccess("users", "removeUser", {
        userId: 999999,
      });

      // 不验证 result，因为可能为 null/undefined
    });
  });

  // ==================== 第4部分：完整流程测试 ====================

  describe("【完整流程】用户生命周期", () => {
    test("6.1 完整流程：创建→编辑→禁用→启用→删除", async () => {
      // Step 1: 创建用户
      const createResult = await expectSuccess("users", "addUser", {
        name: `E2E流程测试_${Date.now()}`,
        rpm: 60,
        dailyQuota: 10,
      });

      const userId = createResult.user.id;
      const originalName = createResult.user.name;

      console.log(`   Step 1: 创建用户 ${userId} ✅`);

      // Step 2: 编辑用户
      const editedName = `${originalName}_已编辑`;
      await expectSuccess("users", "editUser", {
        userId,
        name: editedName,
        rpm: 120,
        dailyQuota: 20,
      });

      console.log(`   Step 2: 编辑用户 ✅`);

      // Step 3: 禁用用户
      await expectSuccess("users", "editUser", {
        userId,
        name: editedName, // 保持相同的名称
        isEnabled: false,
      });

      console.log(`   Step 3: 禁用用户 ✅`);

      // Step 4: 启用用户
      await expectSuccess("users", "editUser", {
        userId,
        name: editedName, // 保持相同的名称
        isEnabled: true,
      });

      console.log(`   Step 4: 启用用户 ✅`);

      // Step 5: 删除用户
      await expectSuccess("users", "removeUser", { userId });

      // 验证用户已删除
      const users = await expectSuccess("users", "getUsers");
      const deletedUser = users.find((u: any) => u.id === userId);
      expect(deletedUser).toBeUndefined();

      console.log(`   Step 5: 删除用户 ✅`);
      console.log(`   ✅ 完整流程测试通过`);
    });

    test("6.2 完整流程：创建用户→创建多个Key→删除Key→删除用户", async () => {
      // Step 1: 创建用户
      const userResult = await expectSuccess("users", "addUser", {
        name: `E2E多Key测试_${Date.now()}`,
        rpm: 60,
        dailyQuota: 10,
      });

      const userId = userResult.user.id;
      testData.userIds.push(userId);

      console.log(`   Step 1: 创建用户 ${userId} ✅`);

      // Step 2: 创建3个额外的 Key
      const createdKeys = [];

      for (let i = 1; i <= 3; i++) {
        const _keyResult = await expectSuccess("keys", "addKey", {
          userId,
          name: `测试Key${i}_${Date.now()}`,
        });

        createdKeys.push(_keyResult);
        console.log(`   Step 2.${i}: 创建Key${i} ✅`);
      }

      // Step 3: 获取所有 Keys（应该有4个：1个默认 + 3个新建）
      const keys = await expectSuccess("keys", "getKeys", { userId });
      expect(keys.length).toBe(4);

      console.log(`   Step 3: 验证 Key 数量（4个）✅`);

      // Step 4: 删除用户（会自动删除所有 Keys）
      await expectSuccess("users", "removeUser", { userId });

      console.log(`   Step 4: 删除用户及所有 Keys ✅`);
      console.log(`   ✅ 多Key流程测试通过`);
    });
  });
});
