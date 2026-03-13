const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const MAX_ACTIONS_PER_TURN = 2;

app.use(express.static("public"));

const GRID_W = 12;
const GRID_H = 12;

const BOATS = {
    speedboat: {
        name: "Speedboat L1",
        armor: 0,
        speed: 5,
        firepower: 2,
        ac: 13,
        hp: 30
    },
    armorboat: {
        name: "Armorboat L1",
        armor: 5,
        speed: 0,
        firepower: 2,
        ac: 7,
        hp: 50
    },
    fireboat: {
        name: "Fire-PowerBoat L1",
        armor: 0,
        speed: 2,
        firepower: 5,
        ac: 10,
        hp: 40
    }
};

const game = {
    players: {},       // socket.id -> player
    turnOrder: [],     // socket ids
    currentTurnIndex: 0,
    started: false,
    log: ["Waiting for players..."]
};

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function d6() {
    return randInt(1, 6);
}

function d20() {
    return randInt(1, 20);
}

function currentTurnId() {
    if (game.turnOrder.length === 0) return null;
    return game.turnOrder[game.currentTurnIndex];
}

function isAlive(player) {
    return player && player.hp > 0;
}

function livingPlayers() {
    return Object.values(game.players).filter(isAlive);
}

function nextTurn() {
    if (livingPlayers().length <= 1) {
        const winner = livingPlayers()[0];
        if (winner) {
            game.log.unshift(`Game over. ${winner.name} wins!`);
        } else {
            game.log.unshift(`Game over. No winner.`);
        }
        game.started = false;
        broadcastState();
        return;
    }

    const endingTurnId = currentTurnId();
    const endingPlayer = endingTurnId ? game.players[endingTurnId] : null;
    if (endingPlayer) {
        endingPlayer.movePoints = 0;
    }

    let tries = 0;
    do {
        game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length;
        tries++;
        if (tries > game.turnOrder.length) break;
    } while (!isAlive(game.players[currentTurnId()]));

    const pid = currentTurnId();
    if (pid && game.players[pid]) {
        if (game.players[pid].shield > 0) {
            game.log.unshift(`${game.players[pid].name}'s shield expired as their new turn began.`);
            game.players[pid].shield = 0;
        }
        game.players[pid].movePoints = 0;
        game.players[pid].actionsLeft = MAX_ACTIONS_PER_TURN;
        game.players[pid].hasRolledMoveThisTurn = false;
        game.log.unshift(`It is now ${game.players[pid].name}'s turn (${MAX_ACTIONS_PER_TURN} actions).`);
    }

    broadcastState();
}

function shouldAutoEndTurn(player) {
    const actionsLeft = Number(player.actionsLeft) || 0;
    const movePoints = Number(player.movePoints) || 0;
    return actionsLeft <= 0 && movePoints <= 0;
}

function maybeAutoEndTurn(player) {
    if (!shouldAutoEndTurn(player)) return false;
    nextTurn();
    return true;
}

function broadcastState() {
    io.emit("state", sanitizeGame());
}

function sanitizeGame() {
    return {
        gridW: GRID_W,
        gridH: GRID_H,
        started: game.started,
        currentTurnId: currentTurnId(),
        turnOrder: game.turnOrder,
        players: game.players,
        log: game.log.slice(0, 20)
    };
}

function spawnPosition(index) {
    const preset = [
        { x: 0, y: 0 },
        { x: GRID_W - 1, y: GRID_H - 1 },
        { x: 0, y: GRID_H - 1 },
        { x: GRID_W - 1, y: 0 },
        { x: Math.floor(GRID_W / 2), y: 0 },
        { x: Math.floor(GRID_W / 2), y: GRID_H - 1 }
    ];
    return preset[index % preset.length];
}

function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function occupied(x, y, ignoreId = null) {
    return Object.entries(game.players).some(([id, p]) => {
        if (id === ignoreId) return false;
        return p.hp > 0 && p.x === x && p.y === y;
    });
}

io.on("connection", (socket) => {
    game.players[socket.id] = {
        id: socket.id,
        name: `Player ${Object.keys(game.players).length}`,
        boatKey: null,
        boatName: null,
        armor: 0,
        speed: 0,
        firepower: 0,
        ac: 0,
        hp: 0,
        maxHp: 0,
        shield: 0,
        x: 0,
        y: 0,
        movePoints: 0,
        actionsLeft: 0,
        hasRolledMoveThisTurn: false,
        joined: true
    };

    game.log.unshift(`${game.players[socket.id].name} connected.`);
    broadcastState();

    socket.on("setName", (name) => {
        if (typeof name !== "string") return;
        name = name.trim().slice(0, 20);
        if (!name) return;
        game.players[socket.id].name = name;
        game.log.unshift(`${name} updated their name.`);
        broadcastState();
    });

    socket.on("chooseBoat", (boatKey) => {
        const player = game.players[socket.id];
        if (!player || game.started) return;
        if (!BOATS[boatKey]) return;

        const stats = BOATS[boatKey];
        Object.assign(player, {
            boatKey,
            boatName: stats.name,
            armor: stats.armor,
            speed: stats.speed,
            firepower: stats.firepower,
            ac: stats.ac,
            hp: stats.hp,
            maxHp: stats.hp,
            shield: 0
        });

        game.log.unshift(`${player.name} chose ${stats.name}.`);
        broadcastState();
    });

    socket.on("startGame", () => {
        if (game.started) return;

        const ready = Object.values(game.players).filter((p) => p.boatKey);
        if (ready.length < 2) {
            socket.emit("message", "Need at least 2 players with boats selected.");
            return;
        }

        game.turnOrder = ready.map((p) => p.id);

        ready.forEach((p, index) => {
            const pos = spawnPosition(index);
            p.x = pos.x;
            p.y = pos.y;
            p.shield = 0;
            p.movePoints = 0;
            p.actionsLeft = 0;
            p.hasRolledMoveThisTurn = false;
            p.hp = p.maxHp;
        });

        game.started = true;
        game.currentTurnIndex = 0;
        const firstPlayer = game.players[currentTurnId()];
        if (firstPlayer) {
            firstPlayer.actionsLeft = MAX_ACTIONS_PER_TURN;
        }
        game.log.unshift("Game started.");
        game.log.unshift(`It is now ${game.players[currentTurnId()].name}'s turn (${MAX_ACTIONS_PER_TURN} actions).`);
        broadcastState();
    });

    socket.on("rollMove", () => {
        const player = game.players[socket.id];
        if (!game.started || !player) return;
        if (currentTurnId() !== socket.id) return;
        if (!isAlive(player)) return;
        if ((player.actionsLeft || 0) <= 0) {
            socket.emit("message", "No actions left this turn.");
            return;
        }

        const roll = d6();
        player.movePoints = roll + player.speed;
        player.actionsLeft -= 1;
        player.hasRolledMoveThisTurn = true;
        game.log.unshift(
            `${player.name} used Roll Move: d6(${roll}) + Speed(${player.speed}) = ${player.movePoints}. Actions left: ${player.actionsLeft}`
        );
        if (maybeAutoEndTurn(player)) return;
        broadcastState();
    });

    socket.on("move", (dir) => {
        const player = game.players[socket.id];
        if (!game.started || !player) return;
        if (currentTurnId() !== socket.id) return;
        if (!isAlive(player)) return;
        if (player.movePoints <= 0) return;

        let nx = player.x;
        let ny = player.y;

        if (dir === "up") ny--;
        else if (dir === "down") ny++;
        else if (dir === "left") nx--;
        else if (dir === "right") nx++;
        else return;

        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) return;
        if (occupied(nx, ny, socket.id)) return;

        player.x = nx;
        player.y = ny;
        player.movePoints -= 1;

        game.log.unshift(
            `${player.name} moved to (${nx}, ${ny}). Remaining move: ${player.movePoints}`
        );

        if (maybeAutoEndTurn(player)) return;
        broadcastState();
    });

    socket.on("attack", (targetId) => {
        const attacker = game.players[socket.id];
        const target = game.players[targetId];

        if (!game.started || !attacker || !target) return;
        if (currentTurnId() !== socket.id) return;
        if (!isAlive(attacker) || !isAlive(target)) return;
        if (socket.id === targetId) return;
        if ((attacker.actionsLeft || 0) <= 0) {
            socket.emit("message", "No actions left this turn.");
            return;
        }

        const dist = manhattan(attacker, target);
        if (dist > attacker.firepower) {
            socket.emit("message", `Target out of range. Max range is ${attacker.firepower}.`);
            return;
        }

        const hitRoll = d20();
        attacker.actionsLeft -= 1;
        if (attacker.hasRolledMoveThisTurn && attacker.movePoints > 0) {
            attacker.movePoints = 0;
            game.log.unshift(`${attacker.name} took another action, so remaining movement was lost.`);
        }

        game.log.unshift(
            `${attacker.name} attacks ${target.name}: to-hit d20(${hitRoll}) vs AC ${target.ac}`
        );

        if (hitRoll < target.ac) {
            game.log.unshift(`${attacker.name} missed ${target.name}. Actions left: ${attacker.actionsLeft}`);
            if (maybeAutoEndTurn(attacker)) return;
            broadcastState();
            return;
        }

        const damageRoll = d6();
        let damage = damageRoll;
        let appliedToShield = 0;

        if (target.shield > 0) {
            appliedToShield = Math.min(target.shield, damage);
            target.shield -= appliedToShield;
            damage -= appliedToShield;
        }

        if (damage > 0) {
            target.hp = Math.max(0, target.hp - damage);
        }

        game.log.unshift(
            `${attacker.name} hit ${target.name} for d6(${damageRoll}) damage. Shield blocked ${appliedToShield}. HP damage: ${damage}. ${target.name} HP: ${target.hp}/${target.maxHp}. Actions left: ${attacker.actionsLeft}`
        );

        if (target.hp <= 0) {
            game.log.unshift(`${target.name} has been sunk.`);
        }

        if (maybeAutoEndTurn(attacker)) return;
        broadcastState();
    });

    socket.on("fortify", () => {
        const player = game.players[socket.id];
        if (!game.started || !player) return;
        if (currentTurnId() !== socket.id) return;
        if (!isAlive(player)) return;
        if ((player.actionsLeft || 0) <= 0) {
            socket.emit("message", "No actions left this turn.");
            return;
        }

        const roll = d6();
        const gain = roll;
        player.shield += gain;
        player.actionsLeft -= 1;
        if (player.hasRolledMoveThisTurn && player.movePoints > 0) {
            player.movePoints = 0;
            game.log.unshift(`${player.name} took another action, so remaining movement was lost.`);
        }

        game.log.unshift(
            `${player.name} fortified: d6(${roll}) = +${gain} shield. Total shield: ${player.shield}. Actions left: ${player.actionsLeft}`
        );

        if (maybeAutoEndTurn(player)) return;
        broadcastState();
    });

    socket.on("endTurn", () => {
        const player = game.players[socket.id];
        if (!game.started || !player) return;
        if (currentTurnId() !== socket.id) return;
        nextTurn();
    });

    socket.on("disconnect", () => {
        const player = game.players[socket.id];
        if (player) {
            game.log.unshift(`${player.name} disconnected.`);
        }

        delete game.players[socket.id];
        game.turnOrder = game.turnOrder.filter((id) => id !== socket.id);

        if (game.currentTurnIndex >= game.turnOrder.length) {
            game.currentTurnIndex = 0;
        }

        if (livingPlayers().length <= 1 && game.started) {
            const winner = livingPlayers()[0];
            if (winner) game.log.unshift(`Game over. ${winner.name} wins!`);
            game.started = false;
        }

        broadcastState();
    });
});

server.listen(PORT, () => {
    console.log(`Boat game server running on http://0.0.0.0:${PORT}`);
});
