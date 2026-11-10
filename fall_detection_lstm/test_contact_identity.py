import unittest

from contact_identity import normalize_contact


class ContactIdentityTest(unittest.TestCase):
    def test_email_case_and_space(self):
        self.assertEqual(normalize_contact("  USER@Example.com "), "user@example.com")

    def test_phone_formats_share_one_identity(self):
        self.assertEqual(normalize_contact("0912 345 678"), "+84912345678")
        self.assertEqual(normalize_contact("+84 912 345 678"), "+84912345678")
        self.assertEqual(normalize_contact("84912345678"), "+84912345678")

    def test_invalid_phone_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_contact("1234567890")


if __name__ == "__main__":
    unittest.main()
