import { NextResponse } from "next/server";

/**
 * Stramark deployment: public registration is DISABLED.
 * This endpoint returns 403 regardless of input to prevent account creation.
 * To add a user, edit config/users.json manually (with a fresh bcrypt hash).
 */
export async function POST() {
    return NextResponse.json(
        { error: "Registration is disabled on this deployment" },
        { status: 403 }
    );
}
