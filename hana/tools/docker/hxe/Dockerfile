FROM saplabs/hanaexpress:2.00.072.00.20231123.1

COPY ./start-hdi.sql /usr/sap/HXE/start-hdi.sql
COPY ./setup.sh /setup

# Do initial boot
RUN /setup
