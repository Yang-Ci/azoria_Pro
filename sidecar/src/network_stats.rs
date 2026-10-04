use serde_json::{Value, json};

#[cfg(target_os = "windows")]
pub fn get() -> Result<Value, String> {
    use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    // GetIfTable2 owns the allocation; copy counters before releasing it.
    unsafe {
        let result = GetIfTable2(&mut table);
        if result.0 != 0 || table.is_null() {
            return Err(format!("Network counters unavailable ({})", result.0));
        }
        let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        let interfaces: Vec<Value> = rows.iter()
            .filter(|row| row.OperStatus == IfOperStatusUp && row.Type != 24)
            .map(|row| {
                let length = row.Alias.iter().position(|value| *value == 0).unwrap_or(row.Alias.len());
                json!({ "id": row.InterfaceLuid.Value.to_string(), "name": String::from_utf16_lossy(&row.Alias[..length]),
                    "receivedBytes": row.InOctets.to_string(), "sentBytes": row.OutOctets.to_string() })
            }).collect();
        FreeMibTable(table.cast());
        Ok(json!({ "interfaces": interfaces }))
    }
}

#[cfg(target_os = "linux")]
pub fn get() -> Result<Value, String> {
    let raw = std::fs::read_to_string("/proc/net/dev").map_err(|error| error.to_string())?;
    let mut interfaces = Vec::new();
    for line in raw.lines().skip(2) {
        let Some((name, counters)) = line.split_once(':') else { continue };
        let name = name.trim();
        if name == "lo" { continue }
        let fields: Vec<&str> = counters.split_whitespace().collect();
        if fields.len() < 16 { continue }
        if let (Ok(received), Ok(sent)) = (fields[0].parse::<u64>(), fields[8].parse::<u64>()) {
            interfaces.push(json!({ "id": name, "name": name, "receivedBytes": received.to_string(), "sentBytes": sent.to_string() }));
        }
    }
    Ok(json!({ "interfaces": interfaces }))
}

#[cfg(target_os = "macos")]
pub fn get() -> Result<Value, String> {
    let output = std::process::Command::new("/usr/sbin/netstat").args(["-ibn"]).output().map_err(|error| error.to_string())?;
    if !output.status.success() { return Err("Network counters unavailable".into()) }
    let raw = String::from_utf8_lossy(&output.stdout);
    let mut lines = raw.lines();
    let header: Vec<&str> = lines.next().unwrap_or("").split_whitespace().collect();
    let received = header.iter().position(|column| *column == "Ibytes").ok_or("Missing receive counters")?;
    let sent = header.iter().position(|column| *column == "Obytes").ok_or("Missing send counters")?;
    let mut interfaces = Vec::new();
    for line in lines {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() <= sent.max(received) || fields[0].starts_with("lo") || !fields[2].starts_with("<Link#") { continue }
        if let (Ok(rx), Ok(tx)) = (fields[received].parse::<u64>(), fields[sent].parse::<u64>()) {
            let name = fields[0].trim_end_matches('*');
            interfaces.push(json!({ "id": name, "name": name, "receivedBytes": rx.to_string(), "sentBytes": tx.to_string() }));
        }
    }
    Ok(json!({ "interfaces": interfaces }))
}
