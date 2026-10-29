import { API, getAccessToken } from "./auth";
import { listMyCards } from "./api";
export interface YotoDevice {
  deviceId: string;
  name: string;
  online: boolean;
  deviceType?: string;
}
async function get(path: string) {
  const r = await fetch(API + path, {
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok)
    throw new Error(
      `Yoto request failed (${r.status}). Sign in with player permission and try again.`,
    );
  return r.json();
}
export async function listDevices(): Promise<YotoDevice[]> {
  return (await get("/device-v2/devices/mine")).devices ?? [];
}
export interface FamilyGroup {
  id: string;
  name: string;
  items: { contentId: string }[];
}
export async function listFamilyGroups(): Promise<FamilyGroup[]> {
  const data = await get("/card/family/library/groups");
  return Array.isArray(data) ? data : (data.groups ?? []);
}
export type PlayerAction = "pause" | "resume" | "stop" | "volume" | "play";
export function playerCommand(action: PlayerAction, value?: number | string) {
  if (action === "volume") {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 50
    )
      throw new Error("Choose a volume from 0 to 50.");
    return { topic: "volume/set", payload: { volume: value } };
  }
  if (action === "play") {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
      throw new Error("Select a card from your family library.");
    return {
      topic: "card/start",
      payload: { uri: `https://yoto.io/${value}` },
    };
  }
  if (!["pause", "resume", "stop"].includes(action))
    throw new Error("Unsupported player action.");
  return { topic: `card/${action}`, payload: {} };
}
/** One-shot official MQTT connection. No offline command queue and no automatic replay. */
export async function controlPlayer(
  deviceId: string,
  action: PlayerAction,
  value?: number | string,
) {
  const command = playerCommand(action, value);
  const device = (await listDevices()).find((d) => d.deviceId === deviceId);
  if (!device?.online)
    throw new Error("This player is offline. Turn it on and refresh.");
  if (action === "play") {
    const [mine, groups] = await Promise.all([
      listMyCards(),
      listFamilyGroups(),
    ]);
    if (
      !mine.some((c) => c.cardId === value) &&
      !groups.some((g) => g.items?.some((i) => i.contentId === value))
    )
      throw new Error("That card is not in the loaded family library.");
  }
  const { connect } = await import("mqtt");
  const token = await getAccessToken();
  await new Promise<void>((resolve, reject) => {
    const client = connect(
      "wss://aqrphjqbp3u2z-ats.iot.eu-west-2.amazonaws.com/mqtt",
      {
        keepalive: 30,
        protocol: "wss",
        username: `${deviceId}?x-amz-customauthorizer-name=PublicJWTAuthorizer`,
        password: token,
        clientId: `DASH${deviceId}`,
        reconnectPeriod: 0,
        connectTimeout: 12000,
        queueQoSZero: false,
      },
    );
    let finished = false;
    let sent = false;
    const done = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client.end(true);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () =>
        done(
          new Error(
            "No player acknowledgement received. Refresh player status before trying again.",
          ),
        ),
      18000,
    );
    client.on("error", () =>
      done(
        new Error(
          "Yoto player connection failed. Check permission and connectivity.",
        ),
      ),
    );
    client.on("message", (_topic, payload) => {
      if (!sent) return;
      try {
        const data = JSON.parse(payload.toString());
        const resource = action === "volume" ? "volume" : "card";
        if (data.status?.[resource] === "FAIL")
          done(new Error("The player declined the command."));
        else if (data.status?.[resource] === "OK") done();
      } catch {
        /* unrelated status messages */
      }
    });
    client.on("connect", () =>
      client.subscribe(`device/${deviceId}/response`, { qos: 1 }, (error) => {
        if (error)
          return done(new Error("Could not subscribe to player response."));
        sent = true;
        client.publish(
          `device/${deviceId}/command/${command.topic}`,
          JSON.stringify(command.payload),
          { qos: 0 },
          (error) => {
            if (error) done(new Error("Command could not be sent."));
          },
        );
      }),
    );
  });
}
