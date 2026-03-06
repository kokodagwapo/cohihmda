process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test_jwt_secret_for_role_based_tests_32_chars_min";
process.env.SKIP_DB = process.env.SKIP_DB || "true";
