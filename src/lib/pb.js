import PocketBase from "pocketbase";

// Wenn du lokal arbeitest:
export const pb = new PocketBase("http://127.0.0.1:8090");

// Optional: Session persistieren, z. B. für Admin Login
// pb.authStore.loadFromCookie(document?.cookie || "");
