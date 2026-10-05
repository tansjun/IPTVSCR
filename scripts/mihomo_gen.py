#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 ikuuu Clash 订阅 YAML 生成最小 mihomo 配置：
- 保留全部节点
- 香港节点组成 url-test 组（自动选优/故障切换，避免单节点入口被封导致整体失败）
- GLOBAL 指向该组，global 模式全流量走香港
- 本地监听 7890(HTTP) / 7891(SOCKS)

用法: python mihomo_gen.py <订阅yaml路径> <输出config.yaml路径>
"""
import sys
import yaml

def pick_hk_nodes(proxies):
    """按订阅顺序返回所有香港节点名（优先「香港」，其次 HK/Hong 关键字）"""
    names = [p["name"] for p in proxies if "香港" in p.get("name", "")]
    if not names:
        names = [p["name"] for p in proxies if any(
            k in p.get("name", "").upper() for k in ("HK", "HONG"))]
    return names

def main():
    if len(sys.argv) != 3:
        print("usage: mihomo_gen.py <sub.yaml> <out.yaml>", file=sys.stderr)
        sys.exit(1)
    sub_path, out_path = sys.argv[1], sys.argv[2]
    with open(sub_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    proxies = cfg.get("proxies") or []
    if not proxies:
        print("[ERROR] 订阅中没有可用节点", file=sys.stderr)
        sys.exit(1)
    hk_nodes = pick_hk_nodes(proxies)
    if not hk_nodes:
        print("[ERROR] 订阅中未找到香港节点", file=sys.stderr)
        sys.exit(1)
    new_cfg = {
        "port": 7890,
        "socks-port": 7891,
        "allow-lan": False,
        "mode": "global",
        "log-level": "info",
        "external-controller": "127.0.0.1:9090",
        # 关键：机场 GTM 按解析器地域分流——境外 DNS 会把入口域名解析到空路由 127.127.127.5，
        # 必须用国内 DNS 解析代理服务器域名，才能拿到真实香港入口 IP
        "dns": {
            "enable": True,
            "enhanced-mode": "fake-ip",
            "nameserver": [
                "223.5.5.5",
                "119.29.29.29",
            ],
            "default-nameserver": [
                "223.5.5.5",
                "119.29.29.29",
            ],
            "proxy-server-nameserver": [
                "223.5.5.5",
                "119.29.29.29",
            ],
        },
        "proxies": proxies,
        "proxy-groups": [
            {
                "name": "HK",
                "type": "url-test",
                "url": "http://www.gstatic.com/generate_204",
                "interval": 60,
                "tolerance": 50,
                "proxies": hk_nodes,
            },
            {"name": "GLOBAL", "type": "select", "proxies": ["HK"]},
        ],
    }
    with open(out_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(new_cfg, f, allow_unicode=True, sort_keys=False)
    print(f"[OK] 香港节点 {len(hk_nodes)} 个: {', '.join(hk_nodes[:5])} ...")
    print(f"[OK] 生成配置: {out_path}")

if __name__ == "__main__":
    main()
