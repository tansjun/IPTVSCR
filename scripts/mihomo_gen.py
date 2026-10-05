#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 ikuuu Clash 订阅 YAML 生成最小 mihomo 配置：
- 保留全部节点
- 自动挑选第一个名称含「香港」的节点作为 GLOBAL 出口（global 模式全流量走它）
- 本地监听 7890(HTTP) / 7891(SOCKS)

用法: python mihomo_gen.py <订阅yaml路径> <输出config.yaml路径>
"""
import sys
import yaml

def pick_hk(proxies):
    """优先名字含「香港」，其次 HK/Hong 关键字"""
    for kw in ("香港", "HK", "Hong"):
        for p in proxies:
            if kw.lower() in p.get("name", "").lower():
                return p["name"]
    return None

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
    hk = pick_hk(proxies)
    if not hk:
        print("[ERROR] 订阅中未找到香港节点", file=sys.stderr)
        sys.exit(1)
    new_cfg = {
        "port": 7890,
        "socks-port": 7891,
        "allow-lan": False,
        "mode": "global",
        "log-level": "warning",
        "dns": {"enable": False},
        "proxies": proxies,
        "proxy-groups": [
            {"name": "GLOBAL", "type": "select", "proxies": [hk]}
        ],
    }
    with open(out_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(new_cfg, f, allow_unicode=True, sort_keys=False)
    print(f"[OK] 香港出口节点: {hk}")
    print(f"[OK] 生成配置: {out_path}")

if __name__ == "__main__":
    main()
