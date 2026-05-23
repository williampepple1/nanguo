const API = "";

let mode = "login"; // login | register

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("auth-form-el");
  const errorEl = document.getElementById("auth-error");
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const submitBtn = form.querySelector("button[type=submit]");

  tabLogin.addEventListener("click", () => {
    mode = "login";
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    submitBtn.textContent = "Login";
  });

  tabRegister.addEventListener("click", () => {
    mode = "register";
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    submitBtn.textContent = "Register";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    errorEl.classList.add("hidden");

    if (!username || !password) {
      errorEl.textContent = "Fill in all fields";
      errorEl.classList.remove("hidden");
      return;
    }

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const res = await fetch(API + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      localStorage.setItem("nanguo_token", data.token);
      window.location.href = "/";
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove("hidden");
    }
  });
});
