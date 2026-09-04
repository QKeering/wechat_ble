from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, patch

from app.api.app import phone_login, wx_login
from app.services.app_auth import bind_open_id, is_shadow_phone, login_by_wechat_identity, shadow_phone_for_open_id


class AsyncRequest:
    def __init__(self, payload: dict):
        self.payload = payload
        self.client = SimpleNamespace(host="127.0.0.1")

    async def json(self):
        return self.payload


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

    def test_phone_login_exchanges_temporary_code_before_binding(self):
        request = AsyncRequest({"phone": "13800002019", "code": "123456", "openIdCode": "temporary-wx-code"})
        with (
            patch("app.api.app.wechat_open_id", return_value="real-open-id") as exchange,
            patch("app.api.app.app_auth.login_by_phone", return_value="phone-token") as login,
        ):
            response = asyncio.run(phone_login(request, object(), None))

        exchange.assert_called_once_with("temporary-wx-code")
        login.assert_called_once_with(ANY, None, "13800002019", "123456", "real-open-id", "127.0.0.1")
        self.assertEqual(response["code"], 200)
        self.assertEqual(response["data"]["token"], "phone-token")

    def test_bind_open_id_removes_previous_account_binding(self):
        db = MagicMock()

        bind_open_id(db, 2019, "real-open-id")

        self.assertEqual(db.execute.call_count, 2)
        cleanup_sql = str(db.execute.call_args_list[0].args[0])
        bind_sql = str(db.execute.call_args_list[1].args[0])
        self.assertIn("set open_id=null", cleanup_sql)
        self.assertIn("id<>:user_id", cleanup_sql)
        self.assertIn("set open_id=:open_id", bind_sql)
        self.assertEqual(db.execute.call_args_list[0].args[1], {"open_id": "real-open-id", "user_id": 2019})

    def test_wechat_phone_rebind_targets_phone_account(self):
        db = MagicMock()
        old_target = {"id": 2019, "phone": "13800002019", "openId": "old-open-id"}
        rebound_target = {**old_target, "openId": "real-open-id"}
        with (
            patch("app.services.app_auth.user_by_phone", return_value=old_target),
            patch("app.services.app_auth.user_by_id", return_value=rebound_target),
            patch("app.services.app_auth.record_login") as record_login,
            patch("app.services.app_auth.create_token", return_value="phone-token"),
        ):
            token = login_by_wechat_identity(db, None, "real-open-id", "13800002019", "127.0.0.1")

        self.assertEqual(token, "phone-token")
        self.assertEqual(db.execute.call_count, 2)
        self.assertEqual(db.commit.call_count, 1)
        record_login.assert_called_once_with(db, 2019, "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
