FROM andrius/asterisk:latest

# Copy configuration files
COPY pjsip.conf /etc/asterisk/pjsip.conf
COPY extensions.conf /etc/asterisk/extensions.conf
COPY manager.conf /etc/asterisk/manager.conf
COPY rtp.conf /etc/asterisk/rtp.conf
COPY modules.conf /etc/asterisk/modules.conf

# Install core sounds (English, ulaw) so built-in prompts like hello-world work
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/lib/asterisk/sounds/en && \
    cd /var/lib/asterisk/sounds/en && \
    curl -sL http://downloads.asterisk.org/pub/telephony/sounds/asterisk-core-sounds-en-ulaw-current.tar.gz | tar xz && \
    chown -R asterisk:asterisk /var/lib/asterisk/sounds/en

# Create spool and CDR directories
RUN mkdir -p /var/spool/asterisk/outgoing && \
    chown -R asterisk:asterisk /var/spool/asterisk/outgoing && \
    chmod 777 /var/spool/asterisk/outgoing && \
    mkdir -p /var/log/asterisk/cdr-csv && \
    chown -R asterisk:asterisk /var/log/asterisk/cdr-csv
