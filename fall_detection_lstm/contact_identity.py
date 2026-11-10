"""Canonical login identity for email or Vietnamese mobile numbers."""

import re


def normalize_contact(value: str) -> str:
    value = value.strip().lower()
    digits = re.sub(r"[\s.()-]", "", value)
    if re.fullmatch(r"(?:\+84|84|0)[35789]\d{8}", digits):
        return "+84" + (digits[3:] if digits.startswith("+84") else digits[2:] if digits.startswith("84") else digits[1:])
    if re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        return value
    raise ValueError("Nhập email hoặc số điện thoại Việt Nam hợp lệ.")
