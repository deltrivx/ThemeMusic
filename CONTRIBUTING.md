# 贡献指南

感谢你帮助改进 Theme Music。Issue、文档修正、兼容性反馈和代码贡献都欢迎使用中文提交。

## 提交前

1. 搜索现有 Issue 与 Release，确认问题尚未解决。
2. 隐去 Unraid 登录信息、Navidrome 密码、Cookie、Token、真实公网地址和私人媒体信息。
3. 对界面问题说明 Unraid 版本、浏览器、PC/手机端和运行模式。
4. 对播放问题说明音源类型、音频格式、是否为远程挂载及可重复步骤。

## 开发约定

- 修改当前运行文件后，通过 `scripts/build-release.sh <版本> snapshot` 生成不可变版本快照。
- 不直接修改历史 `versions/<版本>/` 内容。
- 不在测试、日志或提交中写入真实凭据。
- 保持设置保存、OTA、回滚和卸载对现有用户配置兼容。
- 中文用户文案应清晰、简短，并与 README、CHANGELOG 和 PLG 同步。

## 验证

```bash
./scripts/verify-release.sh
./scripts/build-release.sh v1.1.2 snapshot
./scripts/verify-release.sh v1.1.2
```

至少验证 JavaScript 语法、Shell 语法、JSON、版本清单哈希和发布包 SHA256。涉及 Unraid UI 时，还需覆盖仪表盘重绘/克隆和移动端布局。

## Pull Request

PR 请写明：问题、根因、修改、用户影响、验证方式和是否涉及配置迁移。一个 PR 尽量只处理一个明确主题。
