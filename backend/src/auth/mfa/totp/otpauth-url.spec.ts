import { buildOtpAuthUrl } from "./otpauth-url";

describe("buildOtpAuthUrl", () => {
  it("monta a URL otpauth exata", () => {
    expect(buildOtpAuthUrl("LUMEN", "a+b@x.com", "ABC 234")).toBe(
      "otpauth://totp/LUMEN%3Aa%2Bb%40x.com?secret=ABC%20234&issuer=LUMEN&algorithm=SHA1&digits=6&period=30",
    );
  });
});
