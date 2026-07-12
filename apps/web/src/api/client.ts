import axios from "axios";
import { QueryClient } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const api = axios.create({ baseURL: API_URL, withCredentials: true });
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } }
});
