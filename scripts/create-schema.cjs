const mysql = require('mysql2/promise');
const url = new URL(process.env.DATABASE_URL);
const sslParam = url.searchParams.get('ssl');
const config = {
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\/+/, ''),
  ssl: sslParam === 'true' || sslParam === '1' ? { rejectUnauthorized: false } : undefined,
};

(async () => {
  const conn = await mysql.createConnection(config);
  const sql = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      openId VARCHAR(64) NOT NULL UNIQUE,
      name TEXT,
      email VARCHAR(320),
      loginMethod VARCHAR(64),
      role ENUM('user','admin') NOT NULL DEFAULT 'user',
      phone VARCHAR(20),
      referralCode VARCHAR(16) UNIQUE,
      pointsBalance INT NOT NULL DEFAULT 0,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      category ENUM('concert','sports','festival','rally','exhibition','other') NOT NULL DEFAULT 'other',
      eventDate TIMESTAMP NOT NULL,
      venue VARCHAR(200) NOT NULL,
      address VARCHAR(400),
      lat DECIMAL(10,7),
      lng DECIMAL(10,7),
      imageUrl TEXT,
      description TEXT,
      status ENUM('active','cancelled','completed') NOT NULL DEFAULT 'active',
      creatorId INT,
      organizerName VARCHAR(200),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS trips (
      id INT AUTO_INCREMENT PRIMARY KEY,
      eventId INT NOT NULL,
      mode ENUM('bus','van') NOT NULL DEFAULT 'bus',
      status ENUM('collecting','confirmed','in_progress','completed','cancelled') NOT NULL DEFAULT 'collecting',
      minCount INT NOT NULL DEFAULT 15,
      maxCount INT NOT NULL DEFAULT 45,
      currentCount INT NOT NULL DEFAULT 0,
      price INT NOT NULL,
      departureAt TIMESTAMP NOT NULL,
      returnAt TIMESTAMP NULL,
      isRoundTrip BOOLEAN NOT NULL DEFAULT FALSE,
      operatorName VARCHAR(200),
      operatorContact VARCHAR(50),
      notes TEXT,
      creatorId INT,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS boarding_points (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tripId INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      address VARCHAR(400),
      lat DECIMAL(10,7),
      lng DECIMAL(10,7),
      pickupTime TIMESTAMP NULL,
      \`order\` INT NOT NULL DEFAULT 0,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS reservations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      tripId INT NOT NULL,
      boardingPointId INT,
      seats INT NOT NULL DEFAULT 1,
      seatNo VARCHAR(10),
      pointsUsed INT NOT NULL DEFAULT 0,
      passengerName VARCHAR(100),
      passengerPhone VARCHAR(20),
      passengerEmail VARCHAR(320),
      qrToken VARCHAR(64),
      referralCode VARCHAR(16),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reservationId INT NOT NULL,
      totalAmount INT NOT NULL,
      status ENUM('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
      method ENUM('card','kakaopay','naverpay','tosspay','transfer','vbank','mock') NOT NULL,
      chargeType ENUM('billing','prepaid') NOT NULL DEFAULT 'prepaid',
      paidAt TIMESTAMP NULL,
      cancelledAt TIMESTAMP NULL,
      cancelReason ENUM('user_request','trip_not_confirmed','admin','payment_failed'),
      cancelNote VARCHAR(300),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX payments_reservation_idx (reservationId)
    )`,
    `CREATE TABLE IF NOT EXISTS payment_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      paymentId INT NOT NULL,
      type ENUM('fare','theme_fee','discount') NOT NULL,
      amount INT NOT NULL,
      label VARCHAR(100) NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX payment_items_payment_idx (paymentId)
    )`,
    `CREATE TABLE IF NOT EXISTS referrals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      referrerId INT NOT NULL,
      refereeId INT NOT NULL,
      reservationId INT,
      referrerPoints INT NOT NULL DEFAULT 2000,
      refereePoints INT NOT NULL DEFAULT 1000,
      status ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS points (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      type ENUM('referral_earn','booking_earn','admin_grant','usage','refund','welcome') NOT NULL,
      amount INT NOT NULL,
      balanceAfter INT NOT NULL DEFAULT 0,
      description VARCHAR(300),
      refId VARCHAR(100),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const query of sql) {
    await conn.query(query);
    console.log('applied');
  }

  await conn.end();
  console.log('schema-ready');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
