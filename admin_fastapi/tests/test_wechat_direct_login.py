from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import ANY, patch

from app.api.app import wx_login
from app.services.app_auth import is_shadow_phone, shadow_phone_for_open_id


class WechatDirectLoginTests(unittest.TestCase):
    def test_shadow_phone_is_stable_and_not_a_real_mobile_prefix(self):
        first = shadow_phone_for_open_id("openid-user-1")
        second = shadow_phone_for_open_id("openid-user-1")
        other = shadow_phone_for_open_id("openid-user-2")

        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertEqual(len(first), 11)
        self.assertTrue(first.isdigit())
        self.assertTrue(first.startswith("9"))
        self.assertTrue(is_shadow_phone(first))
        self.assertFalse(is_shadow_phone("13800138000"))

    def test_wx_login_exchanges_temporary_code_before_login(self):
        request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
        with (
            patch("app.api.app.wechat_open_id", return_value="real-open-id") as exchange,
            patch("app.api.app.app_auth.login_by_open_id", return_value="direct-token") as login,
        ):
            response = wx_login("temporary-wx-code", request, object(), None)

        exchange.assert_called_once_with("temporary-wx-code")
        login.assert_called_once_with(ANY, None, "real-open-id", "127.0.0.1")
        self.assertEqual(response["code"], 200)
        self.assertEqual(response["data"]["token"], "direct-token")


if __name__ == "__main__":
    unittest.main()
