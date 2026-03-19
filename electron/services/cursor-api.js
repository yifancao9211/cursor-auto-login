import https from "node:https";

function request(hostname, urlPath, token, method = "GET", body = null) {
  return new Promise((resolve) => {
    const headers = {
      accept: "application/json",
      cookie: `WorkosCursorSessionToken=${token}`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      referer: "https://cursor.com/settings",
    };
    if (body) {
      headers["content-type"] = "application/json";
      headers["origin"] = "https://cursor.com";
    }
    const req = https.request(
      {
        hostname,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data: null, raw: data.substring(0, 500) });
          }
        });
      }
    );
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ status: 0, error: "timeout" });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

export const cursorApi = {
  fetchUsage(token) {
    return request("cursor.com", "/api/usage-summary", token);
  },
  fetchStripe(token) {
    return request("cursor.com", "/api/auth/stripe", token);
  },
  /** 获取当前用户的团队列表 (POST) */
  fetchTeams(token) {
    return request("cursor.com", "/api/dashboard/teams", token, "POST", {});
  },
  /** 获取指定团队的计费成员列表 (POST, 分页) */
  fetchTeamSpend(token, teamId, page = 1, pageSize = 50) {
    return request("cursor.com", "/api/dashboard/get-team-spend", token, "POST", {
      teamId: Number(teamId),
      page,
      pageSize,
      sortBy: "name",
      sortDirection: "asc",
    });
  },
};
