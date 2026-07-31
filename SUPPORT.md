# 支持与故障排查

## 先做这些检查

1. 在 **设置 → 用户偏好 → 主题音乐** 查看服务总开关、音源和运行模式。
2. 强制刷新 WebGUI（`Ctrl+F5`），避免浏览器继续使用旧 JS/CSS。
3. Navidrome 用户先点击“测试连接”；本地目录用户确认挂载与读取权限。
4. 查看 `/boot/config/plugins/theme.music/ThemeMusic.state` 确认已安装版本。
5. 不要同时启用 ThemeEffects 的旧音乐实现。

## 常见位置

```text
/boot/config/plugins/theme.music/theme-music.cfg
/boot/config/plugins/theme.music/theme.music.cfg
/boot/config/plugins/theme.music/ThemeMusic.state
/tmp/theme-music-save.log
/tmp/theme-music-update.log
```

## 提交 Issue 时请附带

- Theme Music 与 Unraid 版本；
- 浏览器、设备类型和运行模式；
- 本地目录或 Navidrome 音源；
- 操作步骤、预期行为和实际行为；
- 已脱敏的相关日志。

请勿提交密码、Cookie、Token、完整订阅地址或私人音乐库清单。安全问题请按 [SECURITY.md](SECURITY.md) 私密报告。
