# 安全说明

## 支持范围

安全修复优先覆盖最新正式版。旧版本仅保留回滚能力，不保证单独发布安全补丁。

## 报告安全问题

请不要在公开 Issue 中提交密码、Token、完整配置、日志中的会话信息或可直接利用的漏洞细节。

推荐通过 GitHub 仓库的 **Security → Report a vulnerability** 私密报告功能联系维护者。报告中请包含：

- 受影响版本和 Unraid 版本；
- 本地目录或 Navidrome 音源类型；
- 可重复的最小步骤；
- 影响范围及你已采取的临时缓解措施；
- 已脱敏的日志或截图。

## 凭据处理

- Navidrome 密码写入 `/boot/config/plugins/theme.music/navidrome.secret`，权限为 `0600`。
- 密码不进入普通配置、浏览器配置对象、Release 包或应用日志。
- API 通过 Unraid WebGUI 同源路径提供；不要把 Unraid 管理界面直接暴露到公网。
- 建议为远程访问使用可信 VPN/组网方案，并保持 Unraid、Navidrome 和浏览器处于受支持版本。

## 免责声明

本项目按现状提供，不承诺适用于任何特定用途。许可证中的责任限制仍然适用。
