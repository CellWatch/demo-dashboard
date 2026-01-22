import os

from repos.composite import CompositeRepo
from repos.supabase import SupabaseRpcRepo


def create_repo():
    repos = []

    enable_supabase = (os.getenv("ENABLE_SUPABASE", "1") or "1").strip().lower() not in ("0", "false", "no")
    if enable_supabase:
        repos.append(SupabaseRpcRepo())

    if not repos:
        raise RuntimeError("No measurement sources enabled (set ENABLE_SUPABASE=1 or add another repo source).")

    return CompositeRepo(repos)
